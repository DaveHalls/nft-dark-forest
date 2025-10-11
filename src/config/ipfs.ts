const DEFAULT_PINATA_GATEWAY = 'https://plum-fast-beaver-863.mypinata.cloud';
const DEFAULT_PUBLIC_GATEWAY = 'https://ipfs.io';

export const IPFS_CONFIG = {
  get PINATA_GATEWAY() {
    if (typeof window !== 'undefined') {
      return process.env.NEXT_PUBLIC_PINATA_GATEWAY || DEFAULT_PINATA_GATEWAY;
    }
    return DEFAULT_PINATA_GATEWAY;
  },
  PUBLIC_GATEWAY: DEFAULT_PUBLIC_GATEWAY,
} as const;

export function ipfsToHttp(ipfsUri: string, gateway?: string): string {
  if (!ipfsUri) return '';
  
  const selectedGateway = gateway || IPFS_CONFIG.PINATA_GATEWAY;
  
  if (ipfsUri.startsWith('ipfs://')) {
    const cid = ipfsUri.replace('ipfs://', '');
    return `${selectedGateway}/ipfs/${cid}`;
  }
  
  if (ipfsUri.startsWith('ipfs/')) {
    return `${selectedGateway}/${ipfsUri}`;
  }
  
  return ipfsUri;
}


export function getMetadataUrl(tokenId: number): string {

  const classId = tokenId % 5;
  const baseUri = 'ipfs://bafybeiacskzbuan2gevcbnda7wd43k6dnz7u5oflnml2ihasqvhfsp5x2u';
  return ipfsToHttp(`${baseUri}/${classId}.json`);
}

