import { ipcRenderer } from 'electron'

// This preload belongs only to the bundled chooser, never the app or a remote popup.
window.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('devices')
  const connect = document.getElementById('connect')
  const cancel = document.getElementById('cancel')
  const heading = document.getElementById('heading')
  const hint = document.getElementById('hint')
  if (
    !(list instanceof HTMLSelectElement) ||
    !(connect instanceof HTMLButtonElement) ||
    !(cancel instanceof HTMLButtonElement) ||
    !heading ||
    !hint
  ) {
    return
  }
  list.addEventListener('change', () => {
    connect.disabled = list.value === ''
  })
  connect.addEventListener('click', () => {
    ipcRenderer.send('wallet-chooser:select', list.value)
  })
  cancel.addEventListener('click', () => {
    ipcRenderer.send('wallet-chooser:select', '')
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      ipcRenderer.send('wallet-chooser:select', '')
    }
  })
  ipcRenderer.on(
    'wallet-chooser:devices',
    (_event, data: { name: string; devices: { deviceId: string; productName: string }[] }) => {
      heading.textContent = `Connect ${data.name}`
      hint.textContent =
        data.devices.length > 0
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
      connect.disabled = list.value === ''
    },
  )
})
