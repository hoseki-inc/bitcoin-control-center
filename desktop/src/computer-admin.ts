import { execFile } from 'node:child_process'

/** Runs a program and reports whether it exited successfully. */
export type RunProgram = (file: string, args: string[]) => Promise<boolean>

export const runProgram: RunProgram = async (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (error) => {
      resolve(error === null)
    })
  })

const MAC_PROMPT = 'Bitcoin Control Center wants to reset its PIN.'

/**
 * Asks the operating system to confirm that whoever is at the computer is one of its administrators, with the
 * same prompt installers use. Each check runs a program that does nothing, so passing it proves only that the
 * prompt was accepted. False when it's cancelled or refused, or when this system has no such prompt.
 */
export async function confirmComputerAdmin(platform: NodeJS.Platform, run: RunProgram): Promise<boolean> {
  if (platform === 'darwin') {
    // The administrator name and password sheet.
    return run('/usr/bin/osascript', [
      '-e',
      `do shell script "/usr/bin/true" with prompt "${MAC_PROMPT}" with administrator privileges`,
    ])
  }
  if (platform === 'win32') {
    // User Account Control. Start-Process throws when the prompt is declined.
    return run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "try { Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','exit' -Verb RunAs -WindowStyle Hidden -Wait -ErrorAction Stop; exit 0 } catch { exit 1 }",
    ])
  }
  if (platform === 'linux') {
    // polkit, which most Linux desktops include.
    return run('pkexec', ['/bin/true'])
  }
  return false
}
