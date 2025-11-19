// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint8, euint16, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract DarkForestNFT is ERC721, Ownable, ZamaEthereumConfig {
    uint256 private _nextTokenId = 1;
    uint256 public constant COOLDOWN_TIME = 5 hours;
    uint256 public constant WIN_REWARD = 1000;
    uint8 public constant MIN_DAMAGE = 1;
    uint256 public constant REVEAL_DELAY = 1 minutes;
    uint256 public constant UPGRADE_DURATION = 1 minutes;

    string private _baseTokenURI;

    string[5] private classNames = [
        "Brave Warrior",
        "Legendary Swordmaster",
        "Shadow Assassin",
        "Elite Archer",
        "Mystic Mage"
    ];

    struct NFTAttributes {
        euint8 attack;
        euint8 defense;
        euint8 hp;
        euint8 speed;
        euint8 luck;
    }

    struct BattleRecord {
        uint256 wins;
        uint256 losses;
        uint256 cooldownUntil;
    }

    struct UpgradeState {
        bool inProgress;
        uint256 completeAt;
        uint8 pendingAttr; // 0..4 corresponds to the five attributes
    }

    struct BattleRequest {
        uint256 attackerId;
        uint256 defenderId;
        address attacker;
        uint256 requestTime;
        bool isPending;
        bool isRevealed;
        bool attackerWins;
        // Removed encryptedResult from struct to avoid reference issues; use separate mapping
    }

    mapping(uint256 => NFTAttributes) private attributes;
    mapping(uint256 => BattleRecord) public battleRecords;
    mapping(uint256 => bool) private attributesGenerated;
    mapping(uint256 => BattleRequest) private battleRequests;
    mapping(uint256 => uint256) private tokenIdToBattleRequest;
    mapping(uint256 => UpgradeState) private upgradeStates;
    // Separate mapping for encrypted results to preserve FHE references
    mapping(uint256 => euint64) private battleResults;
    // Additional encrypted explanation fields per request
    mapping(uint256 => euint8) private battleReasonCode; // 1..4
    mapping(uint256 => euint8) private battleFaster; // 0/1
    mapping(uint256 => euint8) private battleAttackerCrit; // 0/1
    mapping(uint256 => euint8) private battleDefenderCrit; // 0/1
    // tokenId => classId mapping, storing random class for each NFT
    mapping(uint256 => uint8) private tokenIdToClass;

    address public rewardToken;
    uint256 private _nextRequestId = 1;

    // Accumulated pending rewards (plaintext accumulation, minted to user when claimed)
    mapping(address => uint256) private pendingRewards;

    // Training no longer requires token payment

    event NFTMinted(address indexed owner, uint256 indexed tokenId);
    event BattleInitiated(
        uint256 indexed requestId,
        uint256 indexed attacker,
        uint256 indexed defender,
        uint256 revealTime
    );
    event BattleRevealed(uint256 indexed requestId, uint256 indexed attacker, uint256 indexed defender);
    // Extended with numeric explanation fields for frontend rendering without leaking raw attributes
    // reasonCode: 1=first striker higher score, 2=first striker equal score, 3=second striker higher score, 4=attacker failed
    // faster/attackerCrit/defenderCrit: 0/1
    event BattleEnded(
        uint256 indexed requestId,
        uint256 indexed winner,
        uint256 indexed loser,
        address winnerOwner,
        uint8 reasonCode,
        uint8 faster,
        uint8 attackerCrit,
        uint8 defenderCrit
    );
    event UpgradeStarted(uint256 indexed tokenId, uint8 attrIndex, uint256 completeAt);
    event UpgradeFinished(uint256 indexed tokenId, uint8 attrIndex, bool success);
    event RewardAccrued(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);

    constructor() ERC721("Dark Forest NFT", "DFN") Ownable(msg.sender) {}

    function setRewardToken(address _rewardToken) external onlyOwner {
        rewardToken = _rewardToken;
    }

    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        _requireOwned(tokenId);

        string memory baseURI = _baseURI();
        uint256 classId = tokenIdToClass[tokenId];

        return bytes(baseURI).length > 0 ? string(abi.encodePacked(baseURI, _toString(classId), ".json")) : "";
    }

    function getClass(uint256 tokenId) public view returns (string memory) {
        _requireOwned(tokenId);
        return classNames[tokenIdToClass[tokenId]];
    }

    function getClassId(uint256 tokenId) public view returns (uint256) {
        _requireOwned(tokenId);
        return tokenIdToClass[tokenId];
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function mint() external returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);

        _generateAttributes(tokenId);

        emit NFTMinted(msg.sender, tokenId);
        return tokenId;
    }

    function _generateAttributes(uint256 tokenId) private {
        address owner = ownerOf(tokenId);

        // Use on-chain pseudo-random for class (0-4)
        // Class is not sensitive, pseudo-random is acceptable
        uint256 randomSeed = uint256(
            keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, tokenId, _nextTokenId))
        );
        tokenIdToClass[tokenId] = uint8(randomSeed % 5);

        // Combat attributes use FHE true random encryption, these are sensitive
        attributes[tokenId] = NFTAttributes({
            attack: FHE.rem(FHE.randEuint8(), 101),
            defense: FHE.rem(FHE.randEuint8(), 101),
            hp: FHE.rem(FHE.randEuint8(), 101),
            speed: FHE.rem(FHE.randEuint8(), 101),
            luck: FHE.rem(FHE.randEuint8(), 101)
        });

        FHE.allowThis(attributes[tokenId].attack);
        FHE.allowThis(attributes[tokenId].defense);
        FHE.allowThis(attributes[tokenId].hp);
        FHE.allowThis(attributes[tokenId].speed);
        FHE.allowThis(attributes[tokenId].luck);

        FHE.allow(attributes[tokenId].attack, owner);
        FHE.allow(attributes[tokenId].defense, owner);
        FHE.allow(attributes[tokenId].hp, owner);
        FHE.allow(attributes[tokenId].speed, owner);
        FHE.allow(attributes[tokenId].luck, owner);

        attributesGenerated[tokenId] = true;
    }

    function initiateBattle(uint256 attackerTokenId) external returns (uint256) {
        require(ownerOf(attackerTokenId) == msg.sender, "Not owner");
        require(block.timestamp >= battleRecords[attackerTokenId].cooldownUntil, "In cooldown");
        require(!upgradeStates[attackerTokenId].inProgress, "Upgrading");
        require(attributesGenerated[attackerTokenId], "Attributes not generated");
        require(tokenIdToBattleRequest[attackerTokenId] == 0, "Battle pending");

        uint256 defenderTokenId = _selectRandomOpponent(attackerTokenId);
        require(defenderTokenId > 0, "No opponent available");
        require(attributesGenerated[defenderTokenId], "Opponent attributes not generated");

        (
            ebool attackerWinsBool,
            euint8 reasonCodeEnc,
            euint8 fasterEnc,
            euint8 attackerCritEnc,
            euint8 defenderCritEnc
        ) = _computeBattleDetails(attackerTokenId, defenderTokenId);

        // Convert ebool to euint64 (0 or 1) for decryption compatibility with uint64 output
        euint64 encryptedResult = FHE.select(attackerWinsBool, FHE.asEuint64(1), FHE.asEuint64(0));
        FHE.allowThis(encryptedResult);

        uint256 requestId = _nextRequestId++;
        uint256 revealTime = block.timestamp + REVEAL_DELAY;

        battleRequests[requestId] = BattleRequest({
            attackerId: attackerTokenId,
            defenderId: defenderTokenId,
            attacker: msg.sender,
            requestTime: block.timestamp,
            isPending: true,
            isRevealed: false,
            attackerWins: false
        });

        // Store encrypted result and explanations in separate mappings to avoid struct reference issues
        battleResults[requestId] = encryptedResult;
        battleReasonCode[requestId] = reasonCodeEnc;
        battleFaster[requestId] = fasterEnc;
        battleAttackerCrit[requestId] = attackerCritEnc;
        battleDefenderCrit[requestId] = defenderCritEnc;

        // Allow contract to use explanation fields
        FHE.allowThis(battleReasonCode[requestId]);
        FHE.allowThis(battleFaster[requestId]);
        FHE.allowThis(battleAttackerCrit[requestId]);
        FHE.allowThis(battleDefenderCrit[requestId]);

        tokenIdToBattleRequest[attackerTokenId] = requestId;

        emit BattleInitiated(requestId, attackerTokenId, defenderTokenId, revealTime);

        return requestId;
    }

    function revealBattle(uint256 requestId) external returns (bytes32[] memory handles) {
        BattleRequest storage request = battleRequests[requestId];
        require(request.isPending, "Battle not pending");
        require(!request.isRevealed, "Already revealed");
        require(block.timestamp >= request.requestTime + REVEAL_DELAY, "Reveal delay not met");

        request.isRevealed = true;

        // Use separate mapping for stable references
        euint64 encryptedResult = battleResults[requestId];
        euint8 reasonEnc = battleReasonCode[requestId];
        euint8 fasterEnc = battleFaster[requestId];
        euint8 attackerCritEnc = battleAttackerCrit[requestId];
        euint8 defenderCritEnc = battleDefenderCrit[requestId];

        FHE.allowThis(encryptedResult);
        FHE.allowThis(reasonEnc);
        FHE.allowThis(fasterEnc);
        FHE.allowThis(attackerCritEnc);
        FHE.allowThis(defenderCritEnc);

        // Make all ciphertexts publicly decryptable for v0.9 self-relaying
        FHE.makePubliclyDecryptable(encryptedResult);
        FHE.makePubliclyDecryptable(reasonEnc);
        FHE.makePubliclyDecryptable(fasterEnc);
        FHE.makePubliclyDecryptable(attackerCritEnc);
        FHE.makePubliclyDecryptable(defenderCritEnc);

        // Return handles for frontend to decrypt
        handles = new bytes32[](5);
        handles[0] = FHE.toBytes32(encryptedResult);
        handles[1] = FHE.toBytes32(reasonEnc);
        handles[2] = FHE.toBytes32(fasterEnc);
        handles[3] = FHE.toBytes32(attackerCritEnc);
        handles[4] = FHE.toBytes32(defenderCritEnc);

        emit BattleRevealed(requestId, request.attackerId, request.defenderId);

        return handles;
    }

    function verifyAndFinishBattle(
        uint256 requestId,
        bytes32[] memory handles,
        bytes memory abiEncodedClearValues,
        bytes memory decryptionProof
    ) external {
        // 1. Verify KMS signatures (prevent forged decryption results)
        FHE.checkSignatures(handles, abiEncodedClearValues, decryptionProof);

        BattleRequest storage request = battleRequests[requestId];
        require(request.isPending, "Battle not pending");
        require(request.isRevealed, "Battle not revealed");

        // 2. Decode decrypted result and explanations
        (uint64 resultValue, uint8 reasonCode, uint8 faster, uint8 attackerCrit, uint8 defenderCrit) = abi.decode(
            abiEncodedClearValues,
            (uint64, uint8, uint8, uint8, uint8)
        );
        bool attackerWins = resultValue != 0;

        // 3. Update battle result
        request.attackerWins = attackerWins;
        request.isPending = false;

        // 4. Update battle records and cooldown - only affects attacker (initiator)
        // Defender is completely unaffected (no record, no cooldown)
        if (attackerWins) {
            battleRecords[request.attackerId].wins++;
            // Only winners enter cooldown
            battleRecords[request.attackerId].cooldownUntil = block.timestamp + COOLDOWN_TIME;
        } else {
            battleRecords[request.attackerId].losses++;
            // No cooldown on defeat, can battle again immediately
        }

        // 5. Clear attacker's pending battle flag
        delete tokenIdToBattleRequest[request.attackerId];

        // 6. Accrue winner reward - changed to accumulated rewards, claimed manually from frontend
        if (attackerWins) {
            address attackerOwner = ownerOf(request.attackerId);
            pendingRewards[attackerOwner] += WIN_REWARD;
            emit RewardAccrued(attackerOwner, WIN_REWARD);
        }

        // 7. Emit battle end event
        uint256 winnerId = attackerWins ? request.attackerId : request.defenderId;
        uint256 loserId = attackerWins ? request.defenderId : request.attackerId;
        address winnerOwner = ownerOf(winnerId);
        emit BattleEnded(requestId, winnerId, loserId, winnerOwner, reasonCode, faster, attackerCrit, defenderCrit);
    }

    function getRevealHandles(uint256 requestId) external view returns (bytes32[] memory handles) {
        BattleRequest storage request = battleRequests[requestId];
        require(request.isPending, "Battle not pending");
        require(request.isRevealed, "Not revealed yet");

        // Use separate mapping for stable references
        euint64 encryptedResult = battleResults[requestId];
        euint8 reasonEnc = battleReasonCode[requestId];
        euint8 fasterEnc = battleFaster[requestId];
        euint8 attackerCritEnc = battleAttackerCrit[requestId];
        euint8 defenderCritEnc = battleDefenderCrit[requestId];

        // Return handles for frontend to decrypt again if needed
        handles = new bytes32[](5);
        handles[0] = FHE.toBytes32(encryptedResult);
        handles[1] = FHE.toBytes32(reasonEnc);
        handles[2] = FHE.toBytes32(fasterEnc);
        handles[3] = FHE.toBytes32(attackerCritEnc);
        handles[4] = FHE.toBytes32(defenderCritEnc);

        return handles;
    }

    function _selectRandomOpponent(uint256 attackerTokenId) private view returns (uint256) {
        uint256 supply = _nextTokenId - 1;
        if (supply <= 1) return 0;

        uint256 random = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, attackerTokenId)));

        uint256 opponentIndex = random % (supply - 1);
        uint256 selectedId = opponentIndex + 1;

        if (selectedId >= attackerTokenId) {
            selectedId += 1;
        }

        return selectedId;
    }

    function _computeBattleDetails(
        uint256 attackerId,
        uint256 defenderId
    )
        private
        returns (ebool attackerWins, euint8 reasonCode, euint8 fasterU8, euint8 attackerCritU8, euint8 defenderCritU8)
    {
        NFTAttributes memory attacker = attributes[attackerId];
        NFTAttributes memory defender = attributes[defenderId];

        // Crit flags
        ebool attackerCrit = FHE.gt(attacker.luck, 50);
        ebool defenderCrit = FHE.gt(defender.luck, 50);

        // Damages with crit applied
        euint8 atkDmg = _calcDmg(attacker.attack, defender.defense);
        atkDmg = FHE.select(attackerCrit, FHE.div(FHE.mul(atkDmg, 3), 2), atkDmg);

        euint8 defDmg = _calcDmg(defender.attack, attacker.defense);
        defDmg = FHE.select(defenderCrit, FHE.div(FHE.mul(defDmg, 3), 2), defDmg);

        // Scores
        euint16 atkScore = FHE.mul(FHE.asEuint16(atkDmg), FHE.asEuint16(attacker.hp));
        euint16 defScore = FHE.mul(FHE.asEuint16(defDmg), FHE.asEuint16(defender.hp));

        // Relations
        ebool faster = FHE.gt(attacker.speed, defender.speed);
        ebool higher = FHE.gt(atkScore, defScore);
        ebool equal = FHE.eq(atkScore, defScore);

        // Winner rule
        attackerWins = FHE.select(faster, FHE.or(higher, equal), higher);

        // Encode booleans as u8
        fasterU8 = FHE.select(faster, FHE.asEuint8(1), FHE.asEuint8(0));
        attackerCritU8 = FHE.select(attackerCrit, FHE.asEuint8(1), FHE.asEuint8(0));
        defenderCritU8 = FHE.select(defenderCrit, FHE.asEuint8(1), FHE.asEuint8(0));

        // reasonCode:
        // 1: faster && higher
        // 2: faster && equal
        // 3: !faster && higher
        // 4: otherwise (attacker failed)
        reasonCode = FHE.select(
            FHE.and(faster, higher),
            FHE.asEuint8(1),
            // else
            FHE.select(
                faster,
                // faster && !higher
                FHE.select(equal, FHE.asEuint8(2), FHE.asEuint8(4)),
                // !faster
                FHE.select(higher, FHE.asEuint8(3), FHE.asEuint8(4))
            )
        );
    }

    function _calcDmg(euint8 atk, euint8 def) private returns (euint8) {
        euint8 half = FHE.div(def, 2);
        euint8 dmg = FHE.select(FHE.gt(half, atk), FHE.asEuint8(MIN_DAMAGE), FHE.sub(atk, half));
        return FHE.select(FHE.eq(dmg, 0), FHE.asEuint8(MIN_DAMAGE), dmg);
    }

    function getCooldownRemaining(uint256 tokenId) external view returns (uint256) {
        if (block.timestamp >= battleRecords[tokenId].cooldownUntil) {
            return 0;
        }
        return battleRecords[tokenId].cooldownUntil - block.timestamp;
    }

    function getBattleRecord(
        uint256 tokenId
    ) external view returns (uint256 wins, uint256 losses, uint256 cooldownUntil) {
        BattleRecord memory record = battleRecords[tokenId];
        return (record.wins, record.losses, record.cooldownUntil);
    }

    function getBattleStats(
        uint256 tokenId
    ) external view returns (uint256 wins, uint256 losses, uint256 totalBattles, uint256 winRate) {
        BattleRecord memory record = battleRecords[tokenId];
        wins = record.wins;
        losses = record.losses;
        totalBattles = wins + losses;

        if (totalBattles == 0) {
            winRate = 0;
        } else {
            winRate = (wins * 10000) / totalBattles;
        }

        return (wins, losses, totalBattles, winRate);
    }

    function getBattleRequest(
        uint256 requestId
    )
        external
        view
        returns (
            uint256 attackerId,
            uint256 defenderId,
            address attacker,
            uint256 requestTime,
            uint256 revealTime,
            bool isPending,
            bool isRevealed,
            bool attackerWins
        )
    {
        BattleRequest storage request = battleRequests[requestId];
        return (
            request.attackerId,
            request.defenderId,
            request.attacker,
            request.requestTime,
            request.requestTime + REVEAL_DELAY,
            request.isPending,
            request.isRevealed,
            request.attackerWins
        );
    }

    function getPendingBattleByToken(uint256 tokenId) external view returns (uint256) {
        return tokenIdToBattleRequest[tokenId];
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function tokensOfOwner(address owner) external view returns (uint256[] memory) {
        uint256 supply = _nextTokenId - 1;
        uint256[] memory temp = new uint256[](supply);
        uint256 count = 0;

        for (uint256 i = 1; i <= supply; i++) {
            try this.ownerOf(i) returns (address tokenOwner) {
                if (tokenOwner == owner) {
                    temp[count] = i;
                    count++;
                }
            } catch {
                continue;
            }
        }

        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = temp[i];
        }

        return result;
    }

    function tokensOfOwnerWithDetails(
        address owner
    )
        external
        view
        returns (
            uint256[] memory tokenIds,
            uint8[] memory classIds,
            uint256[] memory wins,
            uint256[] memory losses,
            uint256[] memory cooldowns
        )
    {
        uint256 supply = _nextTokenId - 1;
        uint256[] memory tempIds = new uint256[](supply);
        uint8[] memory tempClasses = new uint8[](supply);
        uint256[] memory tempWins = new uint256[](supply);
        uint256[] memory tempLosses = new uint256[](supply);
        uint256[] memory tempCooldowns = new uint256[](supply);
        uint256 count = 0;

        for (uint256 i = 1; i <= supply; i++) {
            try this.ownerOf(i) returns (address tokenOwner) {
                if (tokenOwner == owner) {
                    tempIds[count] = i;
                    tempClasses[count] = tokenIdToClass[i];
                    BattleRecord memory record = battleRecords[i];
                    tempWins[count] = record.wins;
                    tempLosses[count] = record.losses;
                    tempCooldowns[count] = block.timestamp >= record.cooldownUntil
                        ? 0
                        : record.cooldownUntil - block.timestamp;
                    count++;
                }
            } catch {
                continue;
            }
        }

        tokenIds = new uint256[](count);
        classIds = new uint8[](count);
        wins = new uint256[](count);
        losses = new uint256[](count);
        cooldowns = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            tokenIds[i] = tempIds[i];
            classIds[i] = tempClasses[i];
            wins[i] = tempWins[i];
            losses[i] = tempLosses[i];
            cooldowns[i] = tempCooldowns[i];
        }

        return (tokenIds, classIds, wins, losses, cooldowns);
    }

    // ============ Rewards (claimable) ============
    function getPendingReward(address user) external view returns (uint256) {
        return pendingRewards[user];
    }

    function claimRewards() external {
        uint256 amount = pendingRewards[msg.sender];
        require(amount > 0, "No rewards");
        require(rewardToken != address(0), "Token not set");
        pendingRewards[msg.sender] = 0;
        IDarkForestToken(rewardToken).rewardWinner(msg.sender, amount);
        emit RewardClaimed(msg.sender, amount);
    }

    // ============ Upgrade ============
    function getUpgradeState(
        uint256 tokenId
    ) external view returns (bool inProgress, uint256 completeAt, uint8 pendingAttr) {
        UpgradeState memory st = upgradeStates[tokenId];
        return (st.inProgress, st.completeAt, st.pendingAttr);
    }

    function startUpgrade(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        require(attributesGenerated[tokenId], "Attributes not generated");
        require(!upgradeStates[tokenId].inProgress, "Already upgrading");

        // Randomly select an attribute index 0..4
        uint256 seed = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, tokenId)));
        uint8 attrIndex = uint8(seed % 5);

        upgradeStates[tokenId] = UpgradeState({
            inProgress: true,
            completeAt: block.timestamp + UPGRADE_DURATION,
            pendingAttr: attrIndex
        });

        emit UpgradeStarted(tokenId, attrIndex, upgradeStates[tokenId].completeAt);
    }

    // Supports gas-only training, no token payment required

    function finishUpgrade(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        UpgradeState storage st = upgradeStates[tokenId];
        require(st.inProgress, "No upgrade");
        require(block.timestamp >= st.completeAt, "Not ready");

        // 50% probability calculation
        uint256 seed = uint256(
            keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, tokenId, st.completeAt))
        );
        ebool randomSuccess = FHE.asEbool((seed & 1) == 1);

        // Training only requires gas: directly use random result
        ebool finalSuccess = randomSuccess;

        // Conditional upgrade: only +1 when finalSuccess is true
        if (st.pendingAttr == 0) {
            attributes[tokenId].attack = FHE.select(
                finalSuccess,
                FHE.add(attributes[tokenId].attack, FHE.asEuint8(1)),
                attributes[tokenId].attack
            );
            FHE.allowThis(attributes[tokenId].attack);
            FHE.allow(attributes[tokenId].attack, msg.sender);
        } else if (st.pendingAttr == 1) {
            attributes[tokenId].defense = FHE.select(
                finalSuccess,
                FHE.add(attributes[tokenId].defense, FHE.asEuint8(1)),
                attributes[tokenId].defense
            );
            FHE.allowThis(attributes[tokenId].defense);
            FHE.allow(attributes[tokenId].defense, msg.sender);
        } else if (st.pendingAttr == 2) {
            attributes[tokenId].hp = FHE.select(
                finalSuccess,
                FHE.add(attributes[tokenId].hp, FHE.asEuint8(1)),
                attributes[tokenId].hp
            );
            FHE.allowThis(attributes[tokenId].hp);
            FHE.allow(attributes[tokenId].hp, msg.sender);
        } else if (st.pendingAttr == 3) {
            attributes[tokenId].speed = FHE.select(
                finalSuccess,
                FHE.add(attributes[tokenId].speed, FHE.asEuint8(1)),
                attributes[tokenId].speed
            );
            FHE.allowThis(attributes[tokenId].speed);
            FHE.allow(attributes[tokenId].speed, msg.sender);
        } else {
            attributes[tokenId].luck = FHE.select(
                finalSuccess,
                FHE.add(attributes[tokenId].luck, FHE.asEuint8(1)),
                attributes[tokenId].luck
            );
            FHE.allowThis(attributes[tokenId].luck);
            FHE.allow(attributes[tokenId].luck, msg.sender);
        }

        // Send random result to event (user sees success but attribute unchanged = insufficient balance)
        bool randomResult = (seed & 1) == 1;
        emit UpgradeFinished(tokenId, st.pendingAttr, randomResult);

        delete upgradeStates[tokenId];
    }

    function getEncryptedAttributes(
        uint256 tokenId
    ) external view returns (euint8 attack, euint8 defense, euint8 hp, euint8 speed, euint8 luck) {
        require(attributesGenerated[tokenId], "Attributes not generated");
        NFTAttributes memory attrs = attributes[tokenId];
        return (attrs.attack, attrs.defense, attrs.hp, attrs.speed, attrs.luck);
    }

    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
        address from = super._update(to, tokenId, auth);

        if (to != address(0) && from != to && attributesGenerated[tokenId]) {
            FHE.allow(attributes[tokenId].attack, to);
            FHE.allow(attributes[tokenId].defense, to);
            FHE.allow(attributes[tokenId].hp, to);
            FHE.allow(attributes[tokenId].speed, to);
            FHE.allow(attributes[tokenId].luck, to);
        }

        // When ownership changes, if upgrading, maintain state unchanged
        return from;
    }
}

interface IDarkForestToken {
    function rewardWinner(address winner, uint256 amount) external;

    // Confidential transfer (euint64 passed after upstream fromExternal verification, requires operator authorization)
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64);
}
