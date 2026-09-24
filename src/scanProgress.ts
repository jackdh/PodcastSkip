export type ScanProgressCopy = {
  title: string
  detail: string
  /** One line for the now-playing transcript bar. */
  player: string
}

/** Turn a scan status string into the facts each screen already shows inline. */
export function scanProgressCopy(message: string): ScanProgressCopy {
  const audio = /^Transcribing downloaded audio (\d+\/\d+) · (\d+) at once/.exec(message)
  if (audio) {
    const detail = `${audio[1]} · ${audio[2]} at once`
    return {
      title: 'Transcribing downloaded audio',
      detail,
      player: `Downloaded audio ${detail}`,
    }
  }
  const remaining = /^Transcribing (\d+\/\d+) remaining chunks \((\d+) already saved\)/.exec(message)
  if (remaining) {
    const detail = `remaining chunks · ${remaining[2]} already saved`
    return {
      title: `Transcribing ${remaining[1]}`,
      detail,
      player: `${remaining[1]} · ${remaining[2]} already saved`,
    }
  }
  const title = message.replace(/[….]+$/u, '').trim()
  return { title, detail: '', player: title }
}
