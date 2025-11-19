// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "./lib/openzeppelin/token/ERC7984/ERC7984.sol";

/// @title DarkForest Token
/// @notice Confidential ERC-20 token for Dark Forest game
/// @dev Based on OpenZeppelin's ERC7984 confidential token implementation
contract DarkForestToken is ZamaEthereumConfig, ERC7984 {
    uint64 public totalSupply;
    uint256 public constant MAX_SUPPLY = 10_000_000_000;

    address public owner;
    address public nftContract;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyNFTContract() {
        require(msg.sender == nftContract, "not nft contract");
        _;
    }

    event Minted(address indexed to, uint64 amount);

    constructor() ERC7984("DarkForest", "DF", "") {
        owner = msg.sender;
        totalSupply = 0;
    }

    /// @dev Override decimals to 0 (game token requires no decimals)
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function setNFTContract(address _nftContract) external onlyOwner {
        require(nftContract == address(0), "NFT contract already set");
        nftContract = _nftContract;
    }

    /**
     * @dev Mint tokens (only by NFT contract for rewards)
     */
    function rewardWinner(address winner, uint256 amount) external onlyNFTContract {
        require(winner != address(0), "bad winner");
        require(amount > 0, "bad amount");
        require(totalSupply <= type(uint64).max - amount, "supply overflow");

        euint64 delta = FHE.asEuint64(uint64(amount));
        _mint(winner, delta);

        totalSupply += uint64(amount);
        emit Minted(winner, uint64(amount));
    }

    /**
     * @dev Mint tokens (only by owner for testing)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "bad to");
        require(amount > 0, "bad amount");
        require(totalSupply <= type(uint64).max - amount, "supply overflow");

        euint64 delta = FHE.asEuint64(uint64(amount));
        _mint(to, delta);

        totalSupply += uint64(amount);
        emit Minted(to, uint64(amount));
    }

    /**
     * @dev Get encrypted balance (backward compatible)
     */
    function balanceOf(address user) external view returns (euint64) {
        require(msg.sender == user, "unauthorized");
        return confidentialBalanceOf(user);
    }

    /**
     * @dev Get encrypted balance (backward compatible)
     */
    function encryptedBalanceOf(address user) external view returns (euint64) {
        require(msg.sender == user, "unauthorized");
        return confidentialBalanceOf(user);
    }

    // All transfer functions are provided by base class ConfidentialFungibleToken:
    // - confidentialTransfer(to, externalEuint64, proof)
    // - confidentialTransferFrom(from, to, externalEuint64, proof)
    // - confidentialTransferFrom(from, to, euint64) - operator mode, called by NFT contract
    // Uses setOperator + confidentialTransferFrom pattern

    /**
     * @dev Supply information
     */
    function getSupplyInfo()
        external
        view
        returns (uint256 maxSupply, uint256 currentSupply, uint256 remaining, uint256 percentMinted)
    {
        maxSupply = MAX_SUPPLY;
        currentSupply = totalSupply;
        remaining = MAX_SUPPLY - totalSupply;
        percentMinted = (totalSupply * 10000) / MAX_SUPPLY;
        return (maxSupply, currentSupply, remaining, percentMinted);
    }
}
