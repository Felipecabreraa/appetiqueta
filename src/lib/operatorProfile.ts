const KEY = 'appetiquetado:operatorDisplayName'

export function getStoredOperatorName(): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(KEY)?.trim() ?? ''
}

export function setStoredOperatorName(name: string): void {
  localStorage.setItem(KEY, name.trim())
}
