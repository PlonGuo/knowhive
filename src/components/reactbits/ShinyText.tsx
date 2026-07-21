// ShinyText from React Bits (reactbits.dev), adapted to this codebase's TS + theme
// tokens. Pure CSS shine sweep — keyframes live in src/index.css (@keyframes shine).
interface ShinyTextProps {
  text: string
  disabled?: boolean
  speed?: number
  className?: string
}

export default function ShinyText({ text, disabled = false, speed = 3, className = '' }: ShinyTextProps) {
  return (
    <span
      className={`shiny-text ${disabled ? 'shiny-text-disabled' : ''} ${className}`}
      style={{ animationDuration: `${speed}s` }}
    >
      {text}
    </span>
  )
}
