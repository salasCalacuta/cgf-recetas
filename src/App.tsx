import { useEffect, useId, useMemo, useState } from 'react'
import './App.css'

type Product = {
  id: string
  code: string
  description: string
  unit: string
  groupCode?: string
  rubro?: string
  kind: 'mp' | 'pt' | 'unknown'
  price1: number
  price2: number
  price3: number
  price4: number
  price5: number
  price6: number
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
  return Math.min(6, Math.max(1, Math.round(n)))
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
    maximumFractionDigits: 2,
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
    .map((p) => p as Partial<Product>)
    .filter((p) => typeof p?.code === 'string' && typeof p?.description === 'string')
    .map((p) => ({
      id: typeof p.id === 'string' ? p.id : uid(),
      code: String(p.code),
      description: String(p.description),
      unit: typeof p.unit === 'string' ? p.unit : '',
      groupCode: typeof p.groupCode === 'string' ? p.groupCode : undefined,
      rubro: typeof p.rubro === 'string' ? p.rubro : undefined,
      kind:
        p.kind === 'mp' || p.kind === 'pt' || p.kind === 'unknown' ? p.kind : 'unknown',
      price1: typeof p.price1 === 'number' ? p.price1 : Number((p as any).price1 ?? 0),
      price2: typeof p.price2 === 'number' ? p.price2 : Number((p as any).price2 ?? 0),
      price3: typeof p.price3 === 'number' ? p.price3 : Number((p as any).price3 ?? 0),
      price4: typeof p.price4 === 'number' ? p.price4 : Number((p as any).price4 ?? 0),
      price5: typeof p.price5 === 'number' ? p.price5 : Number((p as any).price5 ?? 0),
      price6: typeof p.price6 === 'number' ? p.price6 : Number((p as any).price6 ?? 0),
      equivalenceQty:
        typeof p.equivalenceQty === 'number'
          ? p.equivalenceQty
          : Number((p as any).equivalenceQty ?? 1),
    }))
    .filter((p) => Number.isFinite(p.price1) && Number.isFinite(p.equivalenceQty))
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
    let kind: Product['kind'] =
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

/** Una sola receta por producto terminado: si había duplicados guardados, se dejan sin PT desde la segunda en adelante. */
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
    out.push({
      id: prev?.id ?? uid(),
      code,
      description: description.trim(),
      unit: unitRaw.trim(),
      groupCode: prev?.groupCode,
      rubro: prev?.rubro,
      kind: 'unknown',
      price1: parseNumberEs(price1Raw),
      price2: parseNumberEs(price2Raw),
      price3: parseNumberEs(price3Raw),
      price4: parseNumberEs(price4Raw),
      price5: parseNumberEs(price5Raw),
      price6: parseNumberEs(price6Raw),
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

    const prices = cols.slice(4, 10).map((p) => parseNumberEs(p))
    const [price1, price2, price3, price4, price5, price6] = [
      prices[0] ?? 0,
      prices[1] ?? 0,
      prices[2] ?? 0,
      prices[3] ?? 0,
      prices[4] ?? 0,
      prices[5] ?? 0,
    ]

    if (!code || !description) continue

    out.push({
      id: prev?.id ?? uid(),
      code,
      description,
      unit,
      groupCode,
      rubro,
      kind: 'unknown',
      price1: Number.isFinite(price1) ? price1 : 0,
      price2: Number.isFinite(price2) ? price2 : 0,
      price3: Number.isFinite(price3) ? price3 : 0,
      price4: Number.isFinite(price4) ? price4 : 0,
      price5: Number.isFinite(price5) ? price5 : 0,
      price6: Number.isFinite(price6) ? price6 : 0,
      equivalenceQty: prev?.equivalenceQty ?? 1,
    })
  }

  return { imported: out, headerLine }
}

function priceForList(product: Product, priceList: number) {
  return priceList === 1
    ? product.price1
    : priceList === 2
      ? product.price2
      : priceList === 3
        ? product.price3
        : priceList === 4
          ? product.price4
          : priceList === 5
            ? product.price5
            : product.price6
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

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('productos')
  const [products, setProducts] = useState<Product[]>(() =>
    normalizeProducts(readStorage('costorecetas-v2-products', [])),
  )
  const [recipes, setRecipes] = useState<Recipe[]>(() =>
    dedupeRecipesByFinishedProduct(normalizeRecipes(readStorage('costorecetas-v2-recipes', []))),
  )
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('')
  const [exportSelection, setExportSelection] = useState<Record<string, boolean>>({})
  const [productSearch, setProductSearch] = useState('')
  const [settings, setSettings] = useState<AppSettings>(() => loadInitialSettings())
  const [exportFileName, setExportFileName] = useState<string>(
    () => readStorage('costorecetas-v2-exportFileName', 'precios'),
  )
  const [importMsg, setImportMsg] = useState('')
  const [recipeMsg, setRecipeMsg] = useState('')
  const fileInputId = useId()

  useEffect(() => {
    localStorage.setItem('costorecetas-v2-products', JSON.stringify(products))
  }, [products])

  useEffect(() => {
    localStorage.setItem('costorecetas-v2-recipes', JSON.stringify(recipes))
  }, [recipes])

  useEffect(() => {
    localStorage.setItem('costorecetas-v2-settings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    localStorage.setItem('costorecetas-v2-exportFileName', JSON.stringify(exportFileName))
  }, [exportFileName])

  useEffect(() => {
    setProducts((prev) =>
      prev.map((p) => {
        const k = classifyProductFromSettings(p, settings)
        return k !== 'unknown' ? { ...p, kind: k } : p
      }),
    )
  }, [settings.finishedIdCode, settings.finishedIdMode, settings.mpIdCode])

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

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.description.localeCompare(b.description, 'es')),
    [products],
  )

  /** Recetas: incluir "sin definir" para poder elegir hasta clasificar en Productos. */
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
    setRecipeMsg('Nueva receta creada.')
    setActiveTab('recetas')
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
      setRecipeMsg('Ya existe una receta para ese producto terminado. Editá la existente o elegí otro.')
      return
    }
    setRecipeMsg('')
    updateRecipe((recipe) => ({ ...recipe, finishedProductCode: code }))
  }

  const importPrn = async (file: File) => {
    setImportMsg('')
    const buf = await file.arrayBuffer()
    // Discovery export suele venir en Windows-1252/ANSI (por eso los acentos se veían como �).
    // Probamos windows-1252 y si falla, caemos a utf-8.
    let text = ''
    try {
      text = new TextDecoder('windows-1252').decode(buf)
    } catch {
      text = new TextDecoder('utf-8').decode(buf)
    }
    const isTab = text.includes('\t')
    const { imported } = isTab
      ? parseTabFile(text, products, settings.finishedIdMode)
      : parsePrn(text, products)

    if (imported.length === 0) {
      setImportMsg('No se pudieron leer productos del archivo. Se esperaba encabezado en línea 6 y datos desde línea 8.')
      return
    }

    const normalized = normalizeProducts(imported)
    const decorated = applyClassificationAfterImport(normalized, products, settings)

    setProducts(decorated)
    setImportMsg(`Se cargaron ${imported.length} productos.`)
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

  return (
    <div className="page">
      <header className="header headerBrandOnly">
        <div className="brand">
          <img className="logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
          <div className="brandText">
            <div className="title">Costos recetas 1.34</div>
          </div>
        </div>
      </header>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'productos' ? 'active' : ''}`}
          type="button"
          onClick={() => setActiveTab('productos')}
        >
          Productos
        </button>
        <button
          className={`tab ${activeTab === 'recetas' ? 'active' : ''}`}
          type="button"
          onClick={() => setActiveTab('recetas')}
        >
          Recetas
        </button>
        <button
          className={`tab ${activeTab === 'parametros' ? 'active' : ''}`}
          type="button"
          onClick={() => setActiveTab('parametros')}
        >
          Parámetros
        </button>
      </div>

      <main className="content">
        {activeTab === 'productos' ? (
          <section className="card">
            <div className="sectionHead">
              <div>
                <h2>Productos Discovery</h2>
              </div>
              <div className="sectionHeadTools">
                <div className="stats">
                  <div className="pill">{products.length} productos</div>
                </div>
                <input
                  id={fileInputId}
                  className="fileInput"
                  type="file"
                  accept=".prn,.txt,.dat,text/plain,application/octet-stream"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void importPrn(f)
                    e.currentTarget.value = ''
                  }}
                />
                <label className="button secondary" htmlFor={fileInputId}>
                  Actualizo precios
                </label>
                <button className="button" type="button" onClick={createRecipe}>
                  Nueva receta
                </button>
              </div>
            </div>

            {importMsg ? <div className="importMsg">{importMsg}</div> : null}

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
              </div>

              {filteredProducts.map((product) => (
                <div className="row rowProducts" key={product.id}>
                  <div>{product.code}</div>
                  <div>{product.description}</div>
                  <div>{product.unit || '-'}</div>
                  <div>{product.groupCode || product.rubro || '-'}</div>
                  <div>{toMoney(priceForList(product, settings.priceListNumber))}</div>
                  <div>
                    <input
                      className="input"
                      inputMode="decimal"
                      value={String(product.equivalenceQty)}
                      onChange={(e) =>
                        setProducts((prev) =>
                          prev.map((item) =>
                            item.id === product.id
                              ? { ...item, equivalenceQty: clampNumber(Number(e.target.value)) }
                              : item,
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
                </div>
              ))}
            </div>
          </section>
        ) : activeTab === 'recetas' ? (
          <div className="recipesLayout">
            <section className="card recipeListCard">
              <div className="sectionHead">
                <div>
                  <h2>Recetas</h2>
                  <p className="muted">Seleccioná una receta para editarla y exportarla.</p>
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
                        '¿Eliminar todas las recetas? Esta acción no se puede deshacer.',
                      )
                    ) {
                      return
                    }
                    setRecipes([])
                    setSelectedRecipeId('')
                    setExportSelection({})
                    setRecipeMsg('Se eliminaron todas las recetas.')
                  }}
                  disabled={recipes.length === 0}
                >
                  Borrar todas las recetas
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => void exportMultipleRecipesTxt(selectedRecipeIdsForExport)}
                  disabled={selectedRecipeIdsForExport.length === 0}
                  title={
                    selectedRecipeIdsForExport.length === 0
                      ? 'Seleccioná una o más recetas'
                      : undefined
                  }
                >
                  Exportar seleccionadas
                </button>
              </div>

              <div className="recipeList">
                {recipes.length === 0 ? <div className="muted">Todavía no hay recetas.</div> : null}
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
                      <strong>{product?.description || 'Receta sin producto'}</strong>
                      <span>{product?.code || 'Sin código'}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="card">
              <div className="sectionHead">
                <div>
                  <h2>Carga recetas</h2>
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
                      setRecipeMsg('Receta eliminada.')
                    }}
                    disabled={!selectedRecipe}
                  >
                    Eliminar receta
                  </button>
                </div>
              </div>

              {!selectedRecipe ? (
                <div className="muted">Creá una receta para empezar.</div>
              ) : (
                <>
                  {recipeMsg ? <div className="importMsg">{recipeMsg}</div> : null}

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
                    <button type="button" className="linkLike" onClick={() => setActiveTab('parametros')}>
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
                      <input
                        className="input"
                        inputMode="decimal"
                        value={String(selectedRecipe.productionQty)}
                        onChange={(e) =>
                          updateRecipe((recipe) => ({
                            ...recipe,
                            productionQty: clampNumber(Number(e.target.value)),
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>% Ganancia</span>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={String(selectedRecipe.marginPct)}
                        onChange={(e) =>
                          updateRecipe((recipe) => ({
                            ...recipe,
                            marginPct: clampNumber(Number(e.target.value)),
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
                                  {productItem.description} ({productItem.code})
                                </option>
                              ))}
                          </select>

                          <input
                            className="input"
                            inputMode="decimal"
                            value={String(line.quantity)}
                            onChange={(e) =>
                              updateRecipe((recipe) => ({
                                ...recipe,
                                lines: recipe.lines.map((item) =>
                                  item.id === line.id
                                    ? { ...item, quantity: clampNumber(Number(e.target.value)) }
                                    : item,
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
                                      : recipe.lines,
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
                      Revisá la receta: cada renglón debe tener una materia prima y una cantidad mayor a 0.
                    </div>
                  ) : null}
                </>
              )}
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
              <span>Lista de precios a usar (1 a 6)</span>
              <select
                className="input"
                value={settings.priceListNumber}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    priceListNumber: clampPriceList(Number(e.target.value)),
                  }))
                }
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    Lista {n}
                  </option>
                ))}
              </select>
              <span className="muted smallHint">
                Se usa para precios en la grilla de productos, costos en recetas y el número de lista en el archivo TXT.
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
                  Archivos LP en formato tab: código, descripción, tercer campo (agrupación o rubro), unidad, precios 1…6.
                  Los archivos PRN sin ese campo no se clasifican solos: podés ajustar el tipo manualmente en Productos.
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
          </section>
        )}
      </main>
    </div>
  )
}

export default App
