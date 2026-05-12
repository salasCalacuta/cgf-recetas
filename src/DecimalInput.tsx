import { useEffect, useRef, useState, type ComponentProps } from 'react'

function formatDecimalDisplay(v: number) {
  if (!Number.isFinite(v)) return ''
  const s = String(v)
  return s.replace('.', ',')
}

function parseDecimalField(raw: string): number {
  const cleaned = raw.trim().replace(/\s+/g, '')
  if (!cleaned || cleaned === '-') return NaN
  const normalized =
    cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : NaN
}

type Props = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: number
  onChange: (n: number) => void
}

export function DecimalInput({ className = 'input', value, onChange, ...rest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(() => formatDecimalDisplay(value))

  useEffect(() => {
    if (document.activeElement === inputRef.current) return
    setText(formatDecimalDisplay(value))
  }, [value])

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      className={className}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        const n = parseDecimalField(t)
        if (Number.isFinite(n)) onChange(n)
      }}
      onBlur={() => {
        const n = parseDecimalField(text)
        const finalN = Number.isFinite(n) ? n : 0
        onChange(finalN)
        setText(formatDecimalDisplay(finalN))
      }}
    />
  )
}
