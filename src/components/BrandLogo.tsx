type Size = 'sm' | 'md' | 'lg'

type Props = {
  className?: string
  size?: Size
}

export function BrandLogo({ className, size = 'md' }: Props) {
  const classes = ['brand-logo', `brand-logo--${size}`]
  if (className) classes.push(className)

  return (
    <img
      src="/logo-agricola-esmeralda.png"
      alt="Agrícola Esmeralda"
      className={classes.join(' ')}
      width={size === 'lg' ? 112 : size === 'sm' ? 32 : 44}
      height={size === 'lg' ? 112 : size === 'sm' ? 32 : 44}
      decoding="async"
    />
  )
}
