/** Locale-owned brand typography with no upstream official artwork. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

type BrandLocale = PropsLocale<'dobeeBrand'>

/**
 * Render the product initial inside the owner's requested square.
 * @param props - Owner geometry and localized brand text.
 * @returns decorative product initial.
 */
export function DobeeBrandMark({ size, className, t }: HeroBrandMarkOwnerProps & BrandLocale) {
  return <svg data-dobee-brand-mark width={size} height={size} className={className} viewBox="0 0 24 24" aria-hidden="true">
    <text x="12" y="18" textAnchor="middle" fill="currentColor" fontSize="20" fontWeight="500">{t('initial')}</text>
  </svg>
}

/**
 * Render the name independently from the square initial.
 * @param props - Localized brand text.
 * @returns decorative product name.
 */
export function DobeeBrandName({ t }: BrandLocale) {
  return <span data-dobee-brand aria-hidden="true">{t('product')}</span>
}
