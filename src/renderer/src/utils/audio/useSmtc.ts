export const mediaSessionController = {
  updatePlaybackState: (state: string) => {
    console.log('SMTC: updatePlaybackState', state)
  },
  updateMetadata: (metadata: any) => {
    console.log('SMTC: updateMetadata', metadata)
  }
}

export default mediaSessionController
