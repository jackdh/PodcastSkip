import type { Preview } from '@storybook/react-vite'
import '../src/styles.css'
import '../src/live.css'

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'dark', values: [{ name: 'dark', value: '#000000' }] }
  }
}

export default preview
