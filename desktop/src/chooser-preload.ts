import { ipcRenderer } from 'electron'

// This preload belongs only to the bundled chooser, never the app or a remote popup.
window.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('devices') as HTMLSelectElement
  const connect = document.getElementById('connect') as HTMLButtonElement
  const cancel = document.getElementById('cancel') as HTMLButtonElement
  list.addEventListener('change', () => (connect.disabled = !list.value))
  connect.addEventListener('click', () => ipcRenderer.send('wallet-chooser:select', list.value))
  cancel.addEventListener('click', () => ipcRenderer.send('wallet-chooser:select', ''))
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') ipcRenderer.send('wallet-chooser:select', '')
  })
  ipcRenderer.on(
    'wallet-chooser:devices',
    (_event, data: { name: string; devices: { deviceId: string; productName: string }[] }) => {
      document.getElementById('heading')!.textContent = `Connect ${data.name}`
      document.getElementById('hint')!.textContent = data.devices.length
        ? 'Choose the wallet you want to connect.'
        : `Plug in and unlock your ${data.name}. Available wallets will appear here.`
      const previous = list.value
      list.replaceChildren(
        ...data.devices.map((device, index) => {
          const option = document.createElement('option')
          option.value = device.deviceId
          option.textContent = `${device.productName || data.name} (${index + 1})`
          return option
        }),
      )
      list.value = previous
      connect.disabled = !list.value
    },
  )
})
