// FadeContent in the spirit of React Bits (reactbits.dev): fade + slight rise on
// mount, via motion. Used for chat message entrances.
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

interface FadeContentProps {
  children: ReactNode
  duration?: number
  delay?: number
  className?: string
  testId?: string
}

export default function FadeContent({
  children,
  duration = 0.35,
  delay = 0,
  className = '',
  testId,
}: FadeContentProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, delay, ease: 'easeOut' }}
      className={className}
      data-testid={testId}
    >
      {children}
    </motion.div>
  )
}
