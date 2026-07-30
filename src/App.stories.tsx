import type { Meta, StoryObj } from '@storybook/react-vite'
import App from './App'

const meta = {
  title: 'Podflow/App',
  component: App,
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'desktop' }
  }
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

export const Desktop: Story = {}

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' }
  }
}
