// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title DarkForestMarket - Simple NFT Marketplace (ETH Settlement)
/// @notice Only supports designated DarkForest NFT, supports listing/delisting/purchasing, configurable platform fee
contract DarkForestMarket is ReentrancyGuard, Ownable {
    struct Listing {
        address seller;
        uint256 price; // wei
        bool active;
    }

    IERC721 public immutable nft;
    address public feeRecipient;
    uint96 public feeBps; // Platform fee in basis points (100 = 1%)

    mapping(uint256 => Listing) public listings;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Canceled(uint256 indexed tokenId, address indexed seller);
    event Bought(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee);

    constructor(address _nft, address _feeRecipient, uint96 _feeBps) Ownable(msg.sender) {
        require(_nft != address(0), "bad nft");
        require(_feeRecipient != address(0), "bad feeRecipient");
        require(_feeBps <= 1000, "fee too high"); // <=10%
        nft = IERC721(_nft);
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
    }

    function setFee(address _recipient, uint96 _feeBps) external onlyOwner {
        require(_recipient != address(0), "bad recipient");
        require(_feeBps <= 1000, "fee too high");
        feeRecipient = _recipient;
        feeBps = _feeBps;
    }

    function list(uint256 tokenId, uint256 price) external nonReentrant {
        require(price > 0, "bad price");
        require(nft.ownerOf(tokenId) == msg.sender, "not owner");
        // Must approve or setApprovalForAll this contract on frontend first
        require(
            nft.getApproved(tokenId) == address(this) || nft.isApprovedForAll(msg.sender, address(this)),
            "not approved"
        );

        listings[tokenId] = Listing({seller: msg.sender, price: price, active: true});
        emit Listed(tokenId, msg.sender, price);
    }

    function cancel(uint256 tokenId) external nonReentrant {
        Listing memory L = listings[tokenId];
        require(L.active, "not listed");
        require(L.seller == msg.sender, "not seller");
        delete listings[tokenId];
        emit Canceled(tokenId, msg.sender);
    }

    function buy(uint256 tokenId) external payable nonReentrant {
        Listing memory L = listings[tokenId];
        require(L.active, "not listed");
        require(L.price == msg.value, "bad value");

        // Re-verify ownership and authorization
        require(nft.ownerOf(tokenId) == L.seller, "seller changed");
        require(
            nft.getApproved(tokenId) == address(this) || nft.isApprovedForAll(L.seller, address(this)),
            "not approved"
        );

        // Calculate platform fee
        uint256 fee = (msg.value * feeBps) / 10000;
        uint256 payout = msg.value - fee;

        // Transfer NFT first, then distribute funds, following checks-effects-interactions pattern
        delete listings[tokenId];
        nft.safeTransferFrom(L.seller, msg.sender, tokenId);

        // Distribute funds
        if (fee > 0) {
            (bool okFee, ) = feeRecipient.call{value: fee}("");
            require(okFee, "fee xfer failed");
        }
        (bool okPay, ) = L.seller.call{value: payout}("");
        require(okPay, "pay failed");

        emit Bought(tokenId, L.seller, msg.sender, L.price, fee);
    }

    function getListing(uint256 tokenId) external view returns (address seller, uint256 price, bool active) {
        Listing memory L = listings[tokenId];
        return (L.seller, L.price, L.active);
    }
}
