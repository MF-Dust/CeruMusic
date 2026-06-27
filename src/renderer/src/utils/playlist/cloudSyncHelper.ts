export async function handleSyncToCloudHelper(...args: any[]): Promise<any> {
  console.log('Sync to cloud:', args)
  return {}
}

export async function handleUploadToCloudHelper(...args: any[]): Promise<any> {
  console.log('Upload to cloud:', args)
  return {}
}

export async function syncLocalMetaWithCloudUpdate(...args: any[]): Promise<any> {
  console.log('Sync local meta with cloud:', args)
  return {}
}

export const cloudSyncHelper = {
  sync: async () => {},
  isSyncing: false
}
export default cloudSyncHelper
