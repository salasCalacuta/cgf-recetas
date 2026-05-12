import { useEffect, useId, useMemo, useState } from 'react'
import { CatalogGate } from './CatalogGate'
import { ConfirmBar } from './ConfirmBar'
import { DecimalInput } from './DecimalInput'
import { LoginScreen } from './LoginScreen'
import './App.css'

const MSG_RECIPE_DUPLICATE_FINISHED_PRODUCT =
  'Ya existe una fórmula para ese producto terminado. Edite la existente o elija otro.'

type Product = {
  id: string
  code: string
  description: string
  unit: string
  groupCode?: string
  rubro?: string
  kind: 'mp' | 'pt' | 'unknown'
  /** Lista 1 = índice 0. Longitud mínima 6; puede crecer si se usa una lista > 6. */
  prices: number[]
  equivalenceQty: number
}

type RecipeLine = {
  id: string
  productCode: string
  quantity: number
}

type Recipe = {
  id: string
  finishedProductCode: string
  productionQty: number
  marginPct: number
  lines: RecipeLine[]
}

type Tab = 'productos' | 'recetas' | 'parametros'

type PendingImportRow = {
  product: Product
  packageQtyText: string
  baseUnitPrice: number
}

type PendingImportState = {
  rows: PendingImportRow[]
  count: number
}

type AppSettings = {
  priceListNumber: number
  finishedIdMode: 'agrupacion' | 'rubro'
  finishedIdCode: string
  mpIdCode: string
  exportFolderPath: string
}

const DEFAULT_SETTINGS: AppSettings = {
  priceListNumber: 1,
  finishedIdMode: 'agrupacion',
  finishedIdCode: 'G003',
  mpIdCode: 'G001',
  exportFolderPath: '',
}

function clampPriceList(n: number) {
  if (!Number.isFinite(n)) return 1
  return Math.min(999, Math.max(1, Math.round(n)))
}

type ParsedPrnResult = {
  imported: Product[]
  headerLine: string
}

function uid() {
  return Math.random().toString(16).slice(2)
}

function clampNumber(n: number) {
  return Number.isFinite(n) ? n : 0
}

function toMoney(n: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(n)
}

function parseNumberEs(raw: string) {
  const cleaned = raw.trim().replace(/\s+/g, '')
  if (!cleaned) return NaN

  // In this PRN prices use ',' as decimal separator; treat '.' as thousands separator when ',' exists.
  const normalized =
    cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '')

  const n = Number(normalized)
  return Number.isFinite(n) ? n : NaN
}

function pricesFromRaw(p: Partial<Product> & Record<string, unknown>): number[] {
  if (Array.isArray(p.prices)) {
    return (p.prices as unknown[]).map((x) =>
      typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0,
    )
  }
  return [1, 2, 3, 4, 5, 6].map((i) => {
    const k = `price${i}` as keyof typeof p
    const v = p[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : Number(v ?? 0) || 0
  })
}

function ensureMinPricesLength(prices: number[], minLen: number) {
  const out = [...prices]
  while (out.length < minLen) out.push(0)
  return out
}

function priceForList(product: Product, priceList: number) {
  const idx = clampPriceList(priceList) - 1
  const arr = product.prices
  return arr[idx] ?? 0
}

function setPriceAtList(product: Product, listNum: number, value: number) {
  const idx = clampPriceList(listNum) - 1
  const next = [...ensureMinPricesLength(product.prices, Math.max(6, idx + 1))]
  next[idx] = value
  return { ...product, prices: next }
}

function mergePriceArraysForImport(prev: number[], inc: number[]) {
  const len = Math.max(prev.length, inc.length, 6)
  const p = ensureMinPricesLength([...prev], len)
  const incoming = [...inc]
  const out: number[] = []
  for (let i = 0; i < len; i += 1) {
    if (i < incoming.length) out.push(Number.isFinite(incoming[i]) ? incoming[i]! : 0)
    else out.push(p[i] ?? 0)
  }
  return out
}

/** Fusiona importación ODBC con el catálogo en memoria: actualiza/crea por código y conserva el resto. */
function mergeProductCatalog(existing: Product[], incoming: Product[]): Product[] {
  const map = new Map<string, Product>(existing.map((p) => [p.code, { ...p }]))
  for (const inc of incoming) {
    const prev = map.get(inc.code)
    if (prev) {
      map.set(inc.code, {
        ...inc,
        id: prev.id,
        equivalenceQty: prev.equivalenceQty,
        kind: prev.kind,
        prices: mergePriceArraysForImport(prev.prices, inc.prices),
      })
    } else {
      map.set(inc.code, { ...inc })
    }
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code, 'es'))
}

/** Cantidad del importador: vacío = sin divisor; número > 0 = aplica a precio unitario. */
function parseImportPackageQty(raw: string): number | null {
  const t = raw.trim().replace(/\s+/g, '')
  if (t === '') return null
  const n = parseNumberEs(t)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function filterNumericQtyInput(raw: string) {
  return raw.replace(/[^\d.,]/g, '')
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function loadInitialSettings(): AppSettings {
  const saved = readStorage<Partial<AppSettings>>('costorecetas-v2-settings', {})
  const legacyList = readStorage<number>('costorecetas-v2-activePriceList', 1)
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    priceListNumber: clampPriceList(
      typeof saved.priceListNumber === 'number' ? saved.priceListNumber : legacyList,
    ),
    finishedIdMode: saved.finishedIdMode === 'rubro' ? 'rubro' : 'agrupacion',
    finishedIdCode:
      typeof saved.finishedIdCode === 'string' && saved.finishedIdCode.trim()
        ? saved.finishedIdCode.trim()
        : DEFAULT_SETTINGS.finishedIdCode,
    mpIdCode:
      typeof saved.mpIdCode === 'string' && saved.mpIdCode.trim()
        ? saved.mpIdCode.trim()
        : DEFAULT_SETTINGS.mpIdCode,
    exportFolderPath:
      typeof saved.exportFolderPath === 'string' ? saved.exportFolderPath : '',
  }
}

function normalizeProducts(raw: unknown): Product[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((p) => p as Partial<Product> & Record<string, unknown>)
    .filter((p) => typeof p?.code === 'string' && typeof p?.description === 'string')
    .map((p) => {
      let prices = pricesFromRaw(p)
      prices = ensureMinPricesLength(prices, 6)
      return {
        id: typeof p.id === 'string' ? p.id : uid(),
        code: String(p.code),
        description: String(p.description),
        unit: typeof p.unit === 'string' ? p.unit : '',
        groupCode: typeof p.groupCode === 'string' ? p.groupCode : undefined,
        rubro: typeof p.rubro === 'string' ? p.rubro : undefined,
        kind:
          p.kind === 'mp' || p.kind === 'pt' || p.kind === 'unknown' ? p.kind : 'unknown',
        prices,
        equivalenceQty:
          typeof p.equivalenceQty === 'number'
            ? p.equivalenceQty
            : Number((p as any).equivalenceQty ?? 1),
      }
    })
    .filter((p) => Number.isFinite(p.prices[0]) && Number.isFinite(p.equivalenceQty))
}

function classifyProductFromSettings(p: Product, s: AppSettings): Product['kind'] {
  if (s.finishedIdMode === 'agrupacion') {
    const g = (p.groupCode || '').trim().toUpperCase()
    const pt = s.finishedIdCode.trim().toUpperCase()
    const mp = s.mpIdCode.trim().toUpperCase()
    if (g && pt && g === pt) return 'pt'
    if (g && mp && g === mp) return 'mp'
    return 'unknown'
  }
  const r = (p.rubro || '').trim().toUpperCase()
  const pt = s.finishedIdCode.trim().toUpperCase()
  const mp = s.mpIdCode.trim().toUpperCase()
  if (r && pt && r === pt) return 'pt'
  if (r && mp && r === mp) return 'mp'
  return 'unknown'
}

function applyClassificationAfterImport(productsIn: Product[], previousProducts: Product[], s: AppSettings): Product[] {
  const previousByCode = new Map(previousProducts.map((p) => [p.code, p]))
  return productsIn.map((p) => {
    const prev = previousByCode.get(p.code)
    const computed = classifyProductFromSettings(p, s)
    const kind: Product['kind'] =
      computed !== 'unknown'
        ? computed
        : prev?.kind && prev.kind !== 'unknown'
          ? prev.kind
          : 'unknown'
    return { ...p, kind }
  })
}

function normalizeRecipes(raw: unknown): Recipe[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r) => r as Partial<Recipe>)
    .filter((r) => typeof r?.id === 'string')
    .map((r) => ({
      id: String(r.id),
      finishedProductCode: typeof r?.finishedProductCode === 'string' ? r.finishedProductCode : '',
      productionQty:
        typeof r.productionQty === 'number' ? r.productionQty : Number((r as any).productionQty ?? 1),
      marginPct: typeof r.marginPct === 'number' ? r.marginPct : Number((r as any).marginPct ?? 30),
      lines: Array.isArray(r.lines)
        ? r.lines
            .map((l) => l as Partial<RecipeLine>)
            .filter((l) => typeof l?.id === 'string')
            .map((l) => ({
              id: String(l.id),
              productCode: typeof l.productCode === 'string' ? l.productCode : '',
              quantity: typeof l.quantity === 'number' ? l.quantity : Number((l as any).quantity ?? 0),
            }))
        : [],
    }))
    .filter((r) => Number.isFinite(r.productionQty) && Number.isFinite(r.marginPct))
}

/** Una sola fórmula por producto terminado: si había duplicados guardados, se dejan sin PT desde la segunda en adelante. */
function dedupeRecipesByFinishedProduct(recipes: Recipe[]): Recipe[] {
  const seen = new Set<string>()
  return recipes.map((r) => {
    const c = r.finishedProductCode.trim()
    if (!c) return r
    if (seen.has(c)) return { ...r, finishedProductCode: '' }
    seen.add(c)
    return r
  })
}

function parsePrn(contents: string, previousProducts: Product[]): ParsedPrnResult {
  const lines = contents.split(/\r?\n/)
  const headerLine = lines[5] ?? ''
  const out: Product[] = []
  const previousByCode = new Map(previousProducts.map((p) => [p.code, p]))

  for (let i = 7; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    const line = raw.trimEnd()
    if (!line.trim()) continue
    if (line.includes('LISTA DE PRECIOS')) continue
    if (line.includes('C¢digo') || line.includes('Código')) continue
    if (/^[-\s]+$/.test(line)) continue
    if (/^MALVADOS/i.test(line.trim())) continue
    if (/^Hoja:/i.test(line.trim())) continue

    // Fixed-width-ish layout:
    // code | description | unit | price1 price2 price3 price4 price5 price6
    // We parse the last 7 columns (unit + 6 prices) by matching them at the end.
    const match = raw.match(/^\s*(\S+)\s+(.+?)\s+(\S+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$/)

    if (!match) continue

    const [, code, description, unitRaw, price1Raw, price2Raw, price3Raw, price4Raw, price5Raw, price6Raw] = match
    const prev = previousByCode.get(code)
    const rawPrices = [price1Raw, price2Raw, price3Raw, price4Raw, price5Raw, price6Raw].map((r) =>
      parseNumberEs(r),
    )
    const prices = rawPrices.map((n) => (Number.isFinite(n) ? n : 0))
    out.push({
      id: prev?.id ?? uid(),
      code,
      description: description.trim(),
      unit: unitRaw.trim(),
      groupCode: prev?.groupCode,
      rubro: prev?.rubro,
      kind: 'unknown',
      prices: ensureMinPricesLength(prices, 6),
      equivalenceQty: prev?.equivalenceQty ?? 1,
    })
  }

  return { imported: out, headerLine }
}

function parseTabFile(
  contents: string,
  previousProducts: Product[],
  finishedIdMode: AppSettings['finishedIdMode'],
): ParsedPrnResult {
  const lines = contents.split(/\r?\n/)
  const headerLine = lines[5] ?? lines[0] ?? ''
  const out: Product[] = []
  const previousByCode = new Map(previousProducts.map((p) => [p.code, p]))

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#')) continue
    if (!line.includes('\t')) continue

    const cols = line.split('\t').map((c) => c.trim())
    if (cols.length < 2) continue

    const code = cols[0]
    const description = cols[1] ?? ''
    const prev = previousByCode.get(code)
    const third = cols[2]?.trim() || ''
    const groupCode =
      finishedIdMode === 'agrupacion' ? (third || prev?.groupCode) : undefined
    const rubro = finishedIdMode === 'rubro' ? (third || prev?.rubro) : undefined
    const unit = cols[3] ?? ''

    const pricesFromCols = cols.slice(4).map((col) => parseNumberEs(col))
    const prices = pricesFromCols.map((n) => (Number.isFinite(n) ? n : 0))

    if (!code || !description) continue

    out.push({
      id: prev?.id ?? uid(),
      code,
      description,
      unit,
      groupCode,
      rubro,
      kind: 'unknown',
      prices: ensureMinPricesLength(prices, 6),
      equivalenceQty: prev?.equivalenceQty ?? 1,
    })
  }

  return { imported: out, headerLine }
}

function unitBaseCost(product: Product, priceList: number) {
  if (!product.equivalenceQty || product.equivalenceQty <= 0) return 0
  const price = priceForList(product, priceList)
  if (!Number.isFinite(price)) return 0
  return price / product.equivalenceQty
}

function computeRecipeSummary(params: {
  recipe: Recipe
  products: Product[]
  activePriceList: number
}) {
  const { recipe, products, activePriceList } = params

  const totalCost = recipe.lines.reduce((acc, line) => {
    const product = products.find((item) => item.code === line.productCode)
    if (!product) return acc
    return acc + unitBaseCost(product, activePriceList) * clampNumber(line.quantity)
  }, 0)

  const unitCost = recipe.productionQty > 0 ? totalCost / recipe.productionQty : 0
  const suggestedPrice = unitCost * (1 + clampNumber(recipe.marginPct) / 100)
  const marginAmount = suggestedPrice - unitCost

  return { totalCost, unitCost, suggestedPrice, marginAmount }
}

function sanitizeExportBaseName(raw: string) {
  return raw.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ') || 'precios'
}

function decodeBestEffort(buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf)
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
    return new TextDecoder('utf-16le', { fatal: false }).decode(buf.slice(2))
  }
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
    try {
      return new TextDecoder('utf-16be', { fatal: false }).decode(buf.slice(2))
    } catch {
      // ignore
    }
  }

  const tryUtf8 = () => new TextDecoder('utf-8', { fatal: false }).decode(buf)
  const tryWin1252 = () => new TextDecoder('windows-1252', { fatal: false }).decode(buf)

  const score = (s: string) => {
    // Lower score = better.
    let points = 0
    // replacement char means decode problems
    points += (s.match(/�/g)?.length ?? 0) * 10
    // common mojibake when UTF-8 decoded as Windows-1252
    points += (s.match(/[ÃÂ]/g)?.length ?? 0) * 2
    // weird control chars that sometimes appear on wrong decodes
    let controlCount = 0
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i)
      if ((c >= 0 && c <= 8) || c === 11 || c === 12 || (c >= 14 && c <= 31)) controlCount += 1
    }
    points += controlCount * 5
    return points
  }

  const utf8 = tryUtf8()
  const win = tryWin1252()
  return score(utf8) <= score(win) ? utf8 : win
}

async function saveExportTxt(params: {
  baseName: string
  contents: string
  exportFolderPath: string
  priceListNumber: number
  setMsg: (s: string) => void
}) {
  const safeBase = sanitizeExportBaseName(params.baseName)
  const electron = typeof window !== 'undefined' ? window.costorecetasElectron : undefined
  const folder = params.exportFolderPath.trim()
  const lista = params.priceListNumber
  if (electron && folder) {
    const res = await electron.saveExportFile(folder, `${safeBase}.txt`, params.contents)
    if (res.ok && res.path) {
      params.setMsg(`Archivo guardado (lista ${lista}, carpeta de Parámetros): ${res.path}`)
      return
    }
    params.setMsg(
      `No se pudo guardar en la carpeta de Parámetros (${res.error ?? 'error'}). Se descarga el archivo (lista ${lista}).`,
    )
  }
  const blob = new Blob([params.contents], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeBase}.txt`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  if (!electron || !folder) {
    params.setMsg(
      electron && !folder
        ? `Archivo descargado (lista ${lista}). Configurá la carpeta en Parámetros para guardarlo ahí en disco.`
        : `Archivo descargado (lista ${lista}).`,
    )
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function stableStringifyProducts(list: Product[]) {
  return JSON.stringify([...list].sort((a, b) => a.code.localeCompare(b.code, 'es')))
}

function stableStringifyRecipes(list: Recipe[]) {
  return JSON.stringify(
    [...list].sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({
      ...r,
      lines: [...r.lines].sort((a, b) => a.id.localeCompare(b.id)),
    })),
  )
}

function App() {
  const storedProductsInit = normalizeProducts(readStorage('costorecetas-v2-products', []))
  const storedRecipesInit = dedupeRecipesByFinishedProduct(
    normalizeRecipes(readStorage('costorecetas-v2-recipes', [])),
  )
  const storedSettingsInit = loadInitialSettings()

  const [loggedIn, setLoggedIn] = useState(
    () => {
      const sessionOk =
        typeof sessionStorage !== 'undefined' && sessionStorage.getItem('costorecetas-v2-auth') === '1'
      if (sessionOk) return true
      try {
        const remember = localStorage.getItem('costorecetas-v2-authRemember') === '1'
        if (remember) sessionStorage.setItem('costorecetas-v2-auth', '1')
        return remember
      } catch {
        return false
      }
    },
  )

  const [activeTab, setActiveTab] = useState<Tab>('productos')
  const [products, setProducts] = useState<Product[]>(storedProductsInit)
  const [productosBaseline, setProductosBaseline] = useState<Product[]>(() => cloneJson(storedProductsInit))
  const [pendingImport, setPendingImport] = useState<PendingImportState | null>(null)

  const [recipes, setRecipes] = useState<Recipe[]>(storedRecipesInit)
  const [recetasBaseline, setRecetasBaseline] = useState<Recipe[]>(() => cloneJson(storedRecipesInit))
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('')
  const [exportSelection, setExportSelection] = useState<Record<string, boolean>>({})
  const [productSearch, setProductSearch] = useState('')
  const [settings, setSettings] = useState<AppSettings>(storedSettingsInit)
  const [parametrosBaseline, setParametrosBaseline] = useState(() => ({
    settings: cloneJson(storedSettingsInit) as AppSettings,
    products: cloneJson(storedProductsInit) as Product[],
  }))
  const [exportFileName, setExportFileName] = useState<string>(
    () => readStorage('costorecetas-v2-exportFileName', 'precios'),
  )
  const [importMsg, setImportMsg] = useState('')
  const [recipeMsg, setRecipeMsg] = useState('')
  const fileInputId = useId()
  const catalogFileInputId = useId()

  useEffect(() => {
    localStorage.setItem('costorecetas-v2-exportFileName', JSON.stringify(exportFileName))
  }, [exportFileName])

  useEffect(() => {
    // Backup diario automático (por ahora dentro de localStorage).
    const today = new Date().toISOString().slice(0, 10)
    const last = readStorage<string>('costorecetas-v2-lastBackup', '')
    if (last === today) return

    const snapshot = {
      createdAt: new Date().toISOString(),
      products,
      recipes,
      settings,
    }

    try {
      localStorage.setItem(`costorecetas-v2-backup-${today}`, JSON.stringify(snapshot))
      localStorage.setItem('costorecetas-v2-lastBackup', JSON.stringify(today))
    } catch {
      // ignore quota errors for now
    }
  }, [products, recipes, settings])

  const productosDirty = useMemo(() => {
    if (pendingImport) return true
    return stableStringifyProducts(products) !== stableStringifyProducts(productosBaseline)
  }, [pendingImport, products, productosBaseline])

  const recetasDirty = useMemo(
    () => stableStringifyRecipes(recipes) !== stableStringifyRecipes(recetasBaseline),
    [recipes, recetasBaseline],
  )

  const parametrosDirty = useMemo(() => {
    const s = JSON.stringify(settings)
    const sb = JSON.stringify(parametrosBaseline.settings)
    return s !== sb
  }, [settings, parametrosBaseline.settings])

  useEffect(() => {
    setPendingImport((prev) => {
      if (!prev) return prev
      const ln = settings.priceListNumber
      return {
        ...prev,
        rows: prev.rows.map((r) => ({
          ...r,
          baseUnitPrice: priceForList(r.product, ln),
        })),
      }
    })
  }, [settings.priceListNumber])

  const selectTab = (t: Tab) => {
    if (t === 'parametros') {
      setParametrosBaseline({
        settings: cloneJson(settings),
        products: cloneJson(products),
      })
    }
    setActiveTab(t)
  }

  const acceptProductos = () => {
    const listN = settings.priceListNumber
    const importedList = pendingImport
      ? pendingImport.rows.map(({ product, packageQtyText, baseUnitPrice }) => {
          const divisor = parseImportPackageQty(packageQtyText)
          const newUnit =
            divisor !== null && divisor > 0 ? baseUnitPrice / divisor : baseUnitPrice
          return setPriceAtList(product, listN, newUnit)
        })
      : null
    const hadProducts = products.length > 0
    const next = importedList ? mergeProductCatalog(products, importedList) : products
    setProducts(next)
    localStorage.setItem('costorecetas-v2-products', JSON.stringify(next))
    setProductosBaseline(cloneJson(next))
    setPendingImport(null)
    setImportMsg(
      importedList
        ? hadProducts
          ? 'Catálogo actualizado: se fusionaron los productos del archivo con el catálogo actual (mismo código se actualiza, códigos nuevos se agregan y el resto se conserva).'
          : 'Catálogo de productos guardado. Podés volver a importar desde la pestaña Productos para actualizar o sumar artículos.'
        : 'Cambios en productos guardados.',
    )
  }

  const cancelProductos = () => {
    setProducts(cloneJson(productosBaseline))
    setPendingImport(null)
    setImportMsg('Se descartaron los cambios pendientes en productos.')
  }

  const acceptRecetas = () => {
    localStorage.setItem('costorecetas-v2-recipes', JSON.stringify(recipes))
    setRecetasBaseline(cloneJson(recipes))
    setRecipeMsg('Cambios de fórmula guardados.')
  }

  const cancelRecetas = () => {
    setRecipes(cloneJson(recetasBaseline))
    setRecipeMsg('Se descartaron los cambios pendientes de fórmula.')
  }

  const acceptParametros = () => {
    const classified = products.map((p) => {
      const k = classifyProductFromSettings(p, settings)
      return k !== 'unknown' ? { ...p, kind: k } : p
    })
    setProducts(classified)
    localStorage.setItem('costorecetas-v2-products', JSON.stringify(classified))
    localStorage.setItem('costorecetas-v2-settings', JSON.stringify(settings))
    setParametrosBaseline({
      settings: cloneJson(settings),
      products: cloneJson(classified),
    })
    setProductosBaseline(cloneJson(classified))
  }

  const cancelParametros = () => {
    setSettings(cloneJson(parametrosBaseline.settings))
    setProducts(cloneJson(parametrosBaseline.products))
  }

  const logout = () => {
    sessionStorage.removeItem('costorecetas-v2-auth')
    try {
      localStorage.removeItem('costorecetas-v2-authRemember')
    } catch {
      // ignore storage errors
    }
    setLoggedIn(false)
  }

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.description.localeCompare(b.description, 'es')),
    [products],
  )

  /** Fórmula: incluir "sin definir" para poder elegir hasta clasificar en Productos. */
  const finishedProducts = useMemo(
    () => sortedProducts.filter((p) => p.kind === 'pt' || p.kind === 'unknown'),
    [sortedProducts],
  )

  const rawMaterials = useMemo(
    () => sortedProducts.filter((p) => p.kind === 'mp' || p.kind === 'unknown'),
    [sortedProducts],
  )

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return sortedProducts
    return sortedProducts.filter((p) => {
      const gc = (p.groupCode ?? '').toLowerCase()
      const rb = (p.rubro ?? '').toLowerCase()
      return (
        p.code.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.unit.toLowerCase().includes(q) ||
        gc.includes(q) ||
        rb.includes(q)
      )
    })
  }, [productSearch, sortedProducts])

  const selectedRecipe =
    recipes.find((recipe) => recipe.id === selectedRecipeId) ??
    recipes[0] ??
    null

  useEffect(() => {
    if (!selectedRecipeId && recipes[0]) {
      setSelectedRecipeId(recipes[0].id)
    }
    if (selectedRecipeId && !recipes.some((recipe) => recipe.id === selectedRecipeId)) {
      setSelectedRecipeId(recipes[0]?.id ?? '')
    }
  }, [recipes, selectedRecipeId])

  const recipeCostSummary = useMemo(() => {
    if (!selectedRecipe) {
      return {
        totalCost: 0,
        unitCost: 0,
        suggestedPrice: 0,
        marginAmount: 0,
      }
    }

    return computeRecipeSummary({
      recipe: selectedRecipe,
      products,
      activePriceList: settings.priceListNumber,
    })
  }, [products, selectedRecipe, settings.priceListNumber])

  const selectedRecipeIdsForExport = useMemo(
    () => Object.entries(exportSelection).filter(([, v]) => v).map(([k]) => k),
    [exportSelection],
  )

  const recipeHasInvalidLines = Boolean(
    selectedRecipe?.lines.some((line) => !line.productCode || clampNumber(line.quantity) <= 0),
  )

  const createRecipe = () => {
    const next: Recipe = {
      id: uid(),
      finishedProductCode: '',
      productionQty: 1,
      marginPct: 30,
      lines: [{ id: uid(), productCode: '', quantity: 0 }],
    }
    setRecipes((prev) => [...prev, next])
    setSelectedRecipeId(next.id)
    setRecipeMsg('Nueva fórmula creada.')
    selectTab('recetas')
  }

  const updateRecipe = (updater: (recipe: Recipe) => Recipe) => {
    if (!selectedRecipe) return
    setRecipes((prev) => prev.map((recipe) => (recipe.id === selectedRecipe.id ? updater(recipe) : recipe)))
  }

  const setFinishedProductCodeForRecipe = (code: string) => {
    if (!selectedRecipe) return
    if (
      code &&
      recipes.some(
        (r) =>
          r.id !== selectedRecipe.id &&
          r.finishedProductCode === code &&
          r.finishedProductCode.trim() !== '',
      )
    ) {
      setRecipeMsg(MSG_RECIPE_DUPLICATE_FINISHED_PRODUCT)
      return
    }
    setRecipeMsg('')
    updateRecipe((recipe) => ({ ...recipe, finishedProductCode: code }))
  }

  const importPrn = async (file: File) => {
    setImportMsg('')
    const buf = await file.arrayBuffer()
    // El export puede venir en Windows-1252 o en UTF-8 (si se exportó/guardó distinto).
    // Elegimos la decodificación con menos "mojibake" (Ã±, �, etc).
    const text = decodeBestEffort(buf)
    const isTab = text.includes('\t')
    const { imported } = isTab
      ? parseTabFile(text, products, settings.finishedIdMode)
      : parsePrn(text, products)

    if (imported.length === 0) {
      setImportMsg(
        'No se pudieron leer productos del archivo ODBC/exportación (.prn, .dat, .txt o .csv con tabuladores). Si es LP en columnas fijas, debe tener encabezado en línea 6 y datos desde línea 8.',
      )
      return
    }

    const normalized = normalizeProducts(imported)
    const decorated = applyClassificationAfterImport(normalized, products, settings)
    const listN = settings.priceListNumber
    const rows: PendingImportRow[] = decorated.map((p) => ({
      product: p,
      packageQtyText: '',
      baseUnitPrice: priceForList(p, listN),
    }))

    setPendingImport({ rows, count: imported.length })
    setImportMsg(
      `Listos para importar ${imported.length} productos. Revisá la tabla y confirmá, o cancelá para elegir otro archivo.`,
    )
  }

  const exportRecipeTxt = async () => {
    if (!selectedRecipe) return
    const finished = products.find((p) => p.code === selectedRecipe.finishedProductCode)
    if (!finished) return

    const precio = recipeCostSummary.suggestedPrice
    const precioTxt = precio.toFixed(2).replace('.', ',')
    const lista = settings.priceListNumber
    const contenido = `${finished.code}\t${lista}\t${precioTxt}`

    await saveExportTxt({
      baseName: exportFileName,
      contents: contenido,
      exportFolderPath: settings.exportFolderPath,
      priceListNumber: lista,
      setMsg: setRecipeMsg,
    })
  }

  const exportMultipleRecipesTxt = async (ids: string[]) => {
    const selected = recipes.filter((recipe) => ids.includes(recipe.id))
    if (selected.length === 0) return

    const lines: string[] = []
    const lista = settings.priceListNumber

    for (const recipe of selected) {
      const finished = products.find((p) => p.code === recipe.finishedProductCode)
      if (!finished) continue
      const summary = computeRecipeSummary({ recipe, products, activePriceList: lista })
      const precioTxt = summary.suggestedPrice.toFixed(2).replace('.', ',')
      lines.push(`${finished.code}\t${lista}\t${precioTxt}`)
    }

    if (lines.length === 0) return

    await saveExportTxt({
      baseName: exportFileName,
      contents: lines.join('\n'),
      exportFolderPath: settings.exportFolderPath,
      priceListNumber: lista,
      setMsg: setRecipeMsg,
    })
  }

  const pickExportFolder = async () => {
    const electron = typeof window !== 'undefined' ? window.costorecetasElectron : undefined
    if (!electron?.pickExportFolder) return
    const picked = await electron.pickExportFolder()
    if (picked) {
      setSettings((prev) => ({ ...prev, exportFolderPath: picked }))
    }
  }

  if (!loggedIn) {
    return <LoginScreen onSuccess={() => setLoggedIn(true)} />
  }

  const needsProductCatalog = products.length === 0

  if (needsProductCatalog) {
    return (
      <CatalogGate
        importMsg={importMsg}
        pendingImport={pendingImport}
        fileInputId={catalogFileInputId}
        priceListNumber={settings.priceListNumber}
        formatMoney={toMoney}
        parsePackageQty={parseImportPackageQty}
        filterNumericQty={filterNumericQtyInput}
        onPendingRowChange={(rowIndex, packageQtyText) => {
          setPendingImport((prev) => {
            if (!prev) return prev
            const rows = [...prev.rows]
            rows[rowIndex] = { ...rows[rowIndex], packageQtyText }
            return { ...prev, rows }
          })
        }}
        onPickFile={(file) => void importPrn(file)}
        onConfirmImport={() => acceptProductos()}
        onCancelImport={() => cancelProductos()}
        onLogout={logout}
      />
    )
  }

  return (
    <div className="page appShell">
      <div className="screenWatermark" aria-hidden>
        <img src={`${import.meta.env.BASE_URL}logoCGF.png`} alt="" />
      </div>

      <header className="header headerBrandOnly">
        <div className="brand">
          <img className="logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
          <div className="brandText">
            <div className="title">Costos fórmula 1.37.0</div>
          </div>
        </div>
        <button className="button secondary logoutBtn" type="button" onClick={logout}>
          Salir
        </button>
      </header>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'productos' ? 'active' : ''}`}
          type="button"
          onClick={() => selectTab('productos')}
        >
          Productos
        </button>
        <button
          className={`tab ${activeTab === 'recetas' ? 'active' : ''}`}
          type="button"
          onClick={() => selectTab('recetas')}
        >
          Fórmula
        </button>
        <button
          className={`tab ${activeTab === 'parametros' ? 'active' : ''}`}
          type="button"
          onClick={() => selectTab('parametros')}
        >
          Parámetros
        </button>
      </div>

      <main className="content contentStacked">
        {activeTab === 'productos' ? (
          <section className="card">
            <div className="sectionHead">
              <div>
                <h2>Productos</h2>
              </div>
              <div className="sectionHeadTools">
                <div className="stats">
                  <div className="pill">
                    {pendingImport ? `${pendingImport.count} a importar` : `${products.length} productos`}
                  </div>
                </div>
                <input
                  id={fileInputId}
                  className="fileInput"
                  type="file"
                  accept=".prn,.txt,.dat,.csv,text/csv,text/plain,application/octet-stream"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void importPrn(f)
                    e.currentTarget.value = ''
                  }}
                />
                <label className="button secondary" htmlFor={fileInputId} title="Importar lista LP (.prn, .dat o .txt tabular)">
                  Actualizo precios
                </label>
                <button className="button" type="button" onClick={createRecipe}>
                  Nueva fórmula
                </button>
              </div>
            </div>

            {importMsg ? <div className="importMsg">{importMsg}</div> : null}

            {pendingImport ? (
              <div className="importPreviewWrap">
                <p className="muted" style={{ marginBottom: 10 }}>
                  Lista de importación (lista de precios activa: {settings.priceListNumber}). Columna Cantidad: solo
                  números (coma o punto decimal). Si queda vacía, en la lista activa se guarda el precio importado. Si
                  hay una cantidad válida mayor a 0, en la lista activa se guarda precio importado ÷ cantidad.
                </p>
                <div className="table importPreviewTable">
                  <div className="row rowImportPreview head">
                    <div>Código</div>
                    <div>Descripción</div>
                    <div>Unidad de medida</div>
                    <div>Precio unitario</div>
                    <div>Cantidad</div>
                  </div>
                  {pendingImport.rows.map((row, idx) => {
                    const divisor = parseImportPackageQty(row.packageQtyText)
                    const displayUnit =
                      divisor !== null && divisor > 0 ? row.baseUnitPrice / divisor : row.baseUnitPrice
                    return (
                      <div className="row rowImportPreview" key={row.product.id}>
                        <div>{row.product.code}</div>
                        <div>{row.product.description}</div>
                        <div>{row.product.unit || '-'}</div>
                        <div>{toMoney(displayUnit)}</div>
                        <div>
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={row.packageQtyText}
                            onChange={(e) => {
                              const v = filterNumericQtyInput(e.target.value)
                              setPendingImport((prev) => {
                                if (!prev) return prev
                                const rows = [...prev.rows]
                                rows[idx] = { ...rows[idx], packageQtyText: v }
                                return { ...prev, rows }
                              })
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <>
                <div className="toolbar">
                  <label className="field searchField">
                    <span>Buscador</span>
                    <input
                      className="input"
                      placeholder="Filtrar por código, descripción, unidad, agrupación o rubro"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                    />
                  </label>
                </div>

                <div className="table">
                  <div className="row rowProducts head">
                    <div>Código</div>
                    <div>Descripción</div>
                    <div>U.M.</div>
                    <div>Agrup. / Rubro</div>
                    <div>Precio {settings.priceListNumber}</div>
                    <div>x Cantidad</div>
                    <div>Costo unitario</div>
                    <div>Tipo</div>
                    <div className="cellRight">Quitar</div>
                  </div>

                  {filteredProducts.map((product) => (
                    <div className="row rowProducts" key={product.id}>
                      <div>{product.code}</div>
                      <div>{product.description}</div>
                      <div>{product.unit || '-'}</div>
                      <div>{product.groupCode || product.rubro || '-'}</div>
                      <div>{toMoney(priceForList(product, settings.priceListNumber))}</div>
                      <div>
                        <DecimalInput
                          className="input"
                          value={product.equivalenceQty}
                          onChange={(n) =>
                            setProducts((prev) =>
                              prev.map((item) =>
                                item.id === product.id ? { ...item, equivalenceQty: clampNumber(n) } : item,
                              ),
                            )
                          }
                        />
                      </div>
                      <div>{toMoney(unitBaseCost(product, settings.priceListNumber))}</div>
                      <div>
                        <select
                          className="input"
                          value={product.kind}
                          onChange={(e) =>
                            setProducts((prev) =>
                              prev.map((item) =>
                                item.id === product.id
                                  ? { ...item, kind: e.target.value as Product['kind'] }
                                  : item,
                              ),
                            )
                          }
                        >
                          <option value="unknown">Sin definir</option>
                          <option value="mp">Materia prima ({settings.mpIdCode})</option>
                          <option value="pt">Producto terminado ({settings.finishedIdCode})</option>
                        </select>
                      </div>
                      <div className="cellRight">
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => {
                            if (!window.confirm(`¿Eliminar el producto ${product.code} de la lista?`)) return
                            setProducts((prev) => prev.filter((item) => item.id !== product.id))
                          }}
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <ConfirmBar
              dirty={productosDirty}
              groupName="productos"
              onAccept={acceptProductos}
              onCancel={cancelProductos}
            />
          </section>
        ) : activeTab === 'recetas' ? (
          <div className="recipesLayout">
            <section className="card recipeListCard">
              <div className="sectionHead">
                <div>
                  <h2>Fórmula</h2>
                  <p className="muted">Seleccioná una fórmula para editarla y exportarla.</p>
                </div>
              </div>

              <div className="recipeTools">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {}
                    recipes.forEach((recipe) => {
                      next[recipe.id] = true
                    })
                    setExportSelection(next)
                  }}
                  disabled={recipes.length === 0}
                >
                  Seleccionar todas
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    setExportSelection({})
                    setRecipeMsg('Se quitaron las marcas de exportación.')
                  }}
                >
                  Quitar marcas export
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    if (recipes.length === 0) return
                    if (
                      !window.confirm(
                        '¿Eliminar todas las fórmulas? Esta acción no se puede deshacer.',
                      )
                    ) {
                      return
                    }
                    setRecipes([])
                    setSelectedRecipeId('')
                    setExportSelection({})
                    setRecipeMsg('Se eliminaron todas las fórmulas.')
                  }}
                  disabled={recipes.length === 0}
                >
                  Borrar todas las fórmulas
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => void exportMultipleRecipesTxt(selectedRecipeIdsForExport)}
                  disabled={selectedRecipeIdsForExport.length === 0}
                  title={
                    selectedRecipeIdsForExport.length === 0
                      ? 'Seleccioná una o más fórmulas'
                      : undefined
                  }
                >
                  Exportar seleccionadas
                </button>
              </div>

              <div className="recipeList">
                {recipes.length === 0 ? <div className="muted">Todavía no hay fórmulas.</div> : null}
                {recipes.map((recipe) => {
                  const product = products.find((p) => p.code === recipe.finishedProductCode)
                  return (
                    <button
                      key={recipe.id}
                      type="button"
                      className={`recipeListItem ${selectedRecipe?.id === recipe.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedRecipeId(recipe.id)
                        setRecipeMsg('')
                      }}
                    >
                      <label
                        className="recipePick"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(exportSelection[recipe.id])}
                          onChange={(e) =>
                            setExportSelection((prev) => ({
                              ...prev,
                              [recipe.id]: e.target.checked,
                            }))
                          }
                        />
                        <span>Exportar</span>
                      </label>
                      <strong>{product?.description || 'Fórmula sin producto'}</strong>
                      <span>{product?.code || 'Sin código'}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="card">
              <div className="sectionHead">
                <div>
                  <h2>Carga de fórmula</h2>
                  <p className="muted">Producto terminado, producción estimada, materias primas y costo unitario.</p>
                </div>
                <div className="headerActions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => void exportRecipeTxt()}
                    disabled={!selectedRecipe}
                  >
                    Exportar resumen
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      if (!selectedRecipe) return
                      setRecipes((prev) => prev.filter((recipe) => recipe.id !== selectedRecipe.id))
                      setRecipeMsg('Fórmula eliminada.')
                    }}
                    disabled={!selectedRecipe}
                  >
                    Eliminar fórmula
                  </button>
                </div>
              </div>

              {!selectedRecipe ? (
                <div className="muted">Creá una fórmula para empezar.</div>
              ) : (
                <>
                  {recipeMsg ? (
                    <div
                      className={
                        recipeMsg === MSG_RECIPE_DUPLICATE_FINISHED_PRODUCT
                          ? 'importMsg importMsgError'
                          : 'importMsg'
                      }
                    >
                      {recipeMsg}
                    </div>
                  ) : null}

                  <div className="toolbar">
                    <label className="field" style={{ margin: 0 }}>
                      <span>Nombre del archivo a exportar</span>
                      <input
                        className="input"
                        value={exportFileName}
                        onChange={(e) => setExportFileName(e.target.value)}
                        placeholder="Ej: lp1000"
                      />
                    </label>
                  </div>
                  <p className="muted" style={{ marginTop: 0 }}>
                    Costos y exportación del TXT usan la lista {settings.priceListNumber} y la carpeta definidas en{' '}
                    <button type="button" className="linkLike" onClick={() => selectTab('parametros')}>
                      Parámetros
                    </button>
                    .
                  </p>

                  {finishedProducts.length === 0 || rawMaterials.length === 0 ? (
                    <div className="hint smallHint" style={{ marginBottom: 12 }}>
                      {finishedProducts.length === 0 ? (
                        <div>
                          No hay productos clasificados como <strong>terminado (PT)</strong>. Definilos en la pestaña
                          Productos.
                        </div>
                      ) : null}
                      {rawMaterials.length === 0 ? (
                        <div style={{ marginTop: finishedProducts.length === 0 ? 8 : 0 }}>
                          No hay productos clasificados como <strong>materia prima (MP)</strong>. Definilos en la pestaña
                          Productos.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="grid3">
                    <label className="field">
                      <span>Producto terminado</span>
                      <select
                        className="input"
                        value={selectedRecipe.finishedProductCode}
                        onChange={(e) => setFinishedProductCodeForRecipe(e.target.value)}
                      >
                        <option value="">Seleccionar producto</option>
                        {finishedProducts.map((product) => (
                          <option key={product.code} value={product.code}>
                            {product.description} ({product.code})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>Producción estimada</span>
                      <DecimalInput
                        className="input"
                        value={selectedRecipe.productionQty}
                        onChange={(n) =>
                          updateRecipe((recipe) => ({
                            ...recipe,
                            productionQty: clampNumber(n),
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>% Ganancia</span>
                      <DecimalInput
                        className="input"
                        value={selectedRecipe.marginPct}
                        onChange={(n) =>
                          updateRecipe((recipe) => ({
                            ...recipe,
                            marginPct: clampNumber(n),
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div className="results resultsRecipeHighlight">
                    <div className="resultRow">
                      <span>Costo total del lote</span>
                      <b>{toMoney(recipeCostSummary.totalCost)}</b>
                    </div>
                    <div className="resultRow">
                      <span>Costo unitario</span>
                      <b>{toMoney(recipeCostSummary.unitCost)}</b>
                    </div>
                    <div className="resultRow">
                      <span>Ganancia por unidad</span>
                      <b>{toMoney(recipeCostSummary.marginAmount)}</b>
                    </div>
                    <div className="resultRow total">
                      <span>Precio sugerido por unidad</span>
                      <b>{toMoney(recipeCostSummary.suggestedPrice)}</b>
                    </div>
                  </div>

                  <div className="table recipeTable">
                    <div className="row rowRecipe head">
                      <div>Materia prima</div>
                      <div>Cantidad consumida</div>
                      <div>Precio unitario</div>
                      <div>Total línea</div>
                      <div></div>
                    </div>

                    {selectedRecipe.lines.map((line) => {
                      const product = products.find((item) => item.code === line.productCode)
                      const lineTotal = product
                        ? unitBaseCost(product, settings.priceListNumber) * clampNumber(line.quantity)
                        : 0
                      return (
                        <div className="row rowRecipe" key={line.id}>
                          <select
                            className="input"
                            value={line.productCode}
                            onChange={(e) =>
                              updateRecipe((recipe) => ({
                                ...recipe,
                                lines: recipe.lines.map((item) =>
                                  item.id === line.id ? { ...item, productCode: e.target.value } : item,
                                ),
                              }))
                            }
                          >
                            <option value="">Seleccionar materia prima</option>
                            {rawMaterials
                              .filter((productItem) => productItem.code !== selectedRecipe.finishedProductCode)
                              .map((productItem) => (
                                <option key={productItem.code} value={productItem.code}>
                                  {productItem.description} ({productItem.code}) -{' '}
                                  {toMoney(priceForList(productItem, settings.priceListNumber))}
                                </option>
                              ))}
                          </select>

                          <DecimalInput
                            className="input"
                            value={line.quantity}
                            onChange={(n) =>
                              updateRecipe((recipe) => ({
                                ...recipe,
                                lines: recipe.lines.map((item) =>
                                  item.id === line.id ? { ...item, quantity: clampNumber(n) } : item,
                                ),
                              }))
                            }
                          />

                          <div className="inlineValue">
                            {product ? toMoney(unitBaseCost(product, settings.priceListNumber)) : '-'}
                          </div>
                          <div className="inlineValue">{toMoney(lineTotal)}</div>
                          <div className="cellRight">
                            <button
                              className="button secondary"
                              type="button"
                              onClick={() =>
                                updateRecipe((recipe) => ({
                                  ...recipe,
                                  lines:
                                    recipe.lines.length > 1
                                      ? recipe.lines.filter((item) => item.id !== line.id)
                                      : [{ id: uid(), productCode: '', quantity: 0 }],
                                }))
                              }
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="cardActions">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() =>
                        updateRecipe((recipe) => ({
                          ...recipe,
                          lines: [...recipe.lines, { id: uid(), productCode: '', quantity: 0 }],
                        }))
                      }
                    >
                    Agregar renglón
                    </button>
                  </div>

                  {recipeHasInvalidLines ? (
                    <div className="errorMsg">
                    Revisá la fórmula: cada renglón debe tener una materia prima y una cantidad mayor a 0.
                    </div>
                  ) : null}
                </>
              )}

              <ConfirmBar
                dirty={recetasDirty}
                groupName="recetas"
                onAccept={acceptRecetas}
                onCancel={cancelRecetas}
              />
            </section>
          </div>
        ) : (
          <section className="card">
            <div className="sectionHead">
              <div>
                <h2>Parámetros</h2>
                <p className="muted">
                  Lista de precios, cómo se reconocen productos terminados en importación tabular, y carpeta de exportación
                  del TXT (app de escritorio).
                </p>
              </div>
            </div>

            <label className="field">
              <span>Lista de precios a usar (1 a 999, máximo 3 dígitos)</span>
              <input
                type="number"
                className="input"
                min={1}
                max={999}
                step={1}
                value={settings.priceListNumber}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    priceListNumber: clampPriceList(Number(e.target.value)),
                  }))
                }
              />
              <span className="muted smallHint">
                Se usa para precios en la grilla de productos, costos de fórmula y el número de lista en el archivo TXT.
                Si la lista es mayor que las columnas importadas, el precio se toma como 0 hasta que lo cargue.
              </span>
            </label>

            <div style={{ marginTop: 16 }}>
              <fieldset className="fieldsetLike">
                <legend className="muted">Productos terminados y materia prima</legend>
                <div className="radioRow">
                  <label>
                    <input
                      type="radio"
                      name="finishedIdMode"
                      checked={settings.finishedIdMode === 'agrupacion'}
                      onChange={() => setSettings((prev) => ({ ...prev, finishedIdMode: 'agrupacion' }))}
                    />
                    Por código de agrupación (columna tab después de descripción)
                  </label>
                </div>
                <div className="radioRow">
                  <label>
                    <input
                      type="radio"
                      name="finishedIdMode"
                      checked={settings.finishedIdMode === 'rubro'}
                      onChange={() => setSettings((prev) => ({ ...prev, finishedIdMode: 'rubro' }))}
                    />
                    Por rubro (misma columna del archivo tab; interpretación según modo)
                  </label>
                </div>

                <label className="field" style={{ marginTop: 12 }}>
                  <span>Código que identifica productos terminados</span>
                  <input
                    className="input"
                    value={settings.finishedIdCode}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, finishedIdCode: e.target.value }))
                    }
                    placeholder="Ej: G003"
                  />
                </label>

                <label className="field">
                  <span>Código que identifica materia prima</span>
                  <input
                    className="input"
                    value={settings.mpIdCode}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, mpIdCode: e.target.value }))
                    }
                    placeholder="Ej: G001"
                  />
                </label>
                <p className="muted smallHint">
                  Archivos LP en formato tab: código, descripción, tercer campo (agrupación o rubro), unidad, luego una
                  columna numérica por cada lista de precios (1, 2, …). Los archivos PRN sin ese campo no se clasifican
                  solos: podés ajustar el tipo manualmente en Productos.
                </p>
              </fieldset>
            </div>

            <div style={{ marginTop: 16 }}>
              <label className="field">
                <span>Carpeta para exportar el TXT</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    value={settings.exportFolderPath}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, exportFolderPath: e.target.value }))
                    }
                    placeholder="Ej: D:\\Exportaciones\\precios"
                  />
                  <button className="button secondary" type="button" onClick={() => void pickExportFolder()}>
                    Elegir carpeta…
                  </button>
                </div>
                <span className="muted smallHint">
                  {typeof window !== 'undefined' && window.costorecetasElectron
                    ? 'Si está vacío o falla el guardado, se descarga el archivo como en el navegador.'
                    : 'En el navegador la exportación siempre descarga el archivo; la carpeta se usa en la aplicación de escritorio.'}
                </span>
              </label>
            </div>

            <ConfirmBar
              dirty={parametrosDirty}
              groupName="parametros"
              onAccept={acceptParametros}
              onCancel={cancelParametros}
            />
          </section>
        )}
      </main>
    </div>
  )
}

export default App
