import { useEffect, useId, useMemo, useState } from 'react'
import './App.css'

type Product = {
  id: string
  code: string
  description: string
  unit: string
  groupCode?: string
  kind: 'mp' | 'pt' | 'both' | 'unknown'
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

type Tab = 'productos' | 'recetas'

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
      kind:
        p.kind === 'mp' || p.kind === 'pt' || p.kind === 'both' || p.kind === 'unknown'
          ? p.kind
          : 'unknown',
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

function kindFromGroupCode(groupCode?: string): Product['kind'] {
  if (!groupCode) return 'unknown'
  const normalized = groupCode.trim().toUpperCase()
  if (normalized === 'G001') return 'mp'
  if (normalized === 'G003') return 'pt'
  return 'unknown'
}

function inferHasClassification(list: Product[]) {
  return list.some((p) => p.kind === 'mp' || p.kind === 'pt' || p.kind === 'both')
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
      kind: prev?.kind ?? 'unknown',
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

function parseTabFile(contents: string, previousProducts: Product[]): ParsedPrnResult {
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
    const groupCode = cols[2] || undefined
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

    const prev = previousByCode.get(code)
    const inferredKind = kindFromGroupCode(groupCode)

    out.push({
      id: prev?.id ?? uid(),
      code,
      description,
      unit,
      groupCode,
      kind: prev?.kind && prev.kind !== 'unknown' ? prev.kind : inferredKind,
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

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('productos')
  const [products, setProducts] = useState<Product[]>(() =>
    normalizeProducts(readStorage('costorecetas-v2-products', [])),
  )
  const [recipes, setRecipes] = useState<Recipe[]>(() => normalizeRecipes(readStorage('costorecetas-v2-recipes', [])))
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('')
  const [exportSelection, setExportSelection] = useState<Record<string, boolean>>({})
  const [productSearch, setProductSearch] = useState('')
  const [activePriceList, setActivePriceList] = useState<number>(
    () => readStorage('costorecetas-v2-activePriceList', 1),
  )
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
    localStorage.setItem('costorecetas-v2-activePriceList', JSON.stringify(activePriceList))
  }, [activePriceList])

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
      activePriceList,
    }

    try {
      localStorage.setItem(`costorecetas-v2-backup-${today}`, JSON.stringify(snapshot))
      localStorage.setItem('costorecetas-v2-lastBackup', JSON.stringify(today))
    } catch {
      // ignore quota errors for now
    }
  }, [activePriceList, products, recipes])

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.description.localeCompare(b.description, 'es')),
    [products],
  )

  const finishedProducts = useMemo(
    () => sortedProducts.filter((p) => p.kind === 'pt' || p.kind === 'both' || p.kind === 'unknown'),
    [sortedProducts],
  )

  const rawMaterials = useMemo(
    () => sortedProducts.filter((p) => p.kind === 'mp' || p.kind === 'both' || p.kind === 'unknown'),
    [sortedProducts],
  )

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return sortedProducts
    return sortedProducts.filter(
      (p) => p.code.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.unit.toLowerCase().includes(q),
    )
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

    return computeRecipeSummary({ recipe: selectedRecipe, products, activePriceList })
  }, [activePriceList, products, selectedRecipe])

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
    const { imported, headerLine } = isTab
      ? parseTabFile(text, products)
      : parsePrn(text, products)

    if (imported.length === 0) {
      setImportMsg('No se pudieron leer productos del archivo. Se esperaba encabezado en línea 6 y datos desde línea 8.')
      return
    }

    const normalized = normalizeProducts(imported)
    const hasClassification = inferHasClassification(normalized)
    const decorated = hasClassification
      ? normalized
      : normalized.map((p) => ({
          ...p,
          kind: kindFromGroupCode(p.groupCode),
        }))

    setProducts(decorated)
    setImportMsg(
      `Importados ${imported.length} productos desde "${file.name}". Encabezado detectado: ${headerLine.trim() || 'sin datos'}.`,
    )
  }

  const exportRecipeTxt = () => {
    if (!selectedRecipe) return
    const finished = products.find((p) => p.code === selectedRecipe.finishedProductCode)
    // Export format solicitado:
    // CODIGO <TAB> LISTA <TAB> PRECIO
    // Para v2 exportamos el precio sugerido de la receta (por unidad) del producto terminado.
    if (!finished) return

    const precio = recipeCostSummary.suggestedPrice
    const precioTxt = precio.toFixed(2).replace('.', ',')
    const contenido = `${finished.code}\t${activePriceList}\t${precioTxt}`

    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeName =
      exportFileName.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ') ||
      'precios'
    a.download = `${safeName}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const exportMultipleRecipesTxt = (ids: string[]) => {
    const selected = recipes.filter((recipe) => ids.includes(recipe.id))
    if (selected.length === 0) return

    const lines: string[] = []

    for (const recipe of selected) {
      const finished = products.find((p) => p.code === recipe.finishedProductCode)
      if (!finished) continue
      const summary = computeRecipeSummary({ recipe, products, activePriceList })
      const precioTxt = summary.suggestedPrice.toFixed(2).replace('.', ',')
      lines.push(`${finished.code}\t${activePriceList}\t${precioTxt}`)
    }

    if (lines.length === 0) return

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeName =
      exportFileName.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ') ||
      'precios'
    a.download = `${safeName}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <img
            className="logo"
            src="/logo.PNG"
            alt="Logo"
            onError={(e) => {
              e.currentTarget.src = '/logo.svg'
            }}
          />
          <div className="brandText">
            <div className="title">Costos recetas v2</div>
          </div>
        </div>
        <div className="headerActions">
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
      </div>

      <main className="content">
        {activeTab === 'productos' ? (
          <section className="card">
            <div className="sectionHead">
              <div>
                <h2>Productos Discovery</h2>
              </div>
              <div className="stats">
                <div className="pill">{products.length} productos</div>
              </div>
            </div>

            {importMsg ? <div className="importMsg">{importMsg}</div> : null}

            <div className="toolbar">
              <input
                className="input"
                placeholder="Buscar por código, descripción o unidad"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>

            <div className="table">
              <div className="row rowProducts head">
                <div>Código</div>
                <div>Descripción</div>
                <div>U.M.</div>
                <div>Precio {activePriceList}</div>
                <div>x Cantidad</div>
                <div>Costo unitario</div>
                <div>Tipo</div>
              </div>

              {filteredProducts.map((product) => (
                <div className="row rowProducts" key={product.id}>
                  <div>{product.code}</div>
                  <div>{product.description}</div>
                  <div>{product.unit || '-'}</div>
                  <div>{toMoney(priceForList(product, activePriceList))}</div>
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
                  <div>{toMoney(unitBaseCost(product, activePriceList))}</div>
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
                      <option value="mp">Materia prima (G001)</option>
                      <option value="pt">Producto terminado (G003)</option>
                      <option value="both">Ambos</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <div className="recipesLayout">
            <section className="card recipeListCard">
              <div className="sectionHead">
                <div>
                  <h2>Recetas</h2>
                  <p className="muted">Guardadas en el navegador. Seleccioná una o creá una nueva.</p>
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
                  onClick={() => setExportSelection({})}
                  disabled={selectedRecipeIdsForExport.length === 0}
                >
                  Limpiar
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => exportMultipleRecipesTxt(selectedRecipeIdsForExport)}
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
                    onClick={exportRecipeTxt}
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
                    <label className="field" style={{ margin: 0 }}>
                      <span>Lista de precios (1-6)</span>
                      <select
                        className="input"
                        value={activePriceList}
                        onChange={(e) => setActivePriceList(clampNumber(Number(e.target.value)) || 1)}
                      >
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid3">
                    <label className="field">
                      <span>Producto terminado</span>
                      <select
                        className="input"
                        value={selectedRecipe.finishedProductCode}
                        onChange={(e) =>
                          updateRecipe((recipe) => ({
                            ...recipe,
                            finishedProductCode: e.target.value,
                          }))
                        }
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
                        ? unitBaseCost(product, activePriceList) * clampNumber(line.quantity)
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
                            {rawMaterials.map((productItem) => (
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
                            {product ? toMoney(unitBaseCost(product, activePriceList)) : '-'}
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

                  <div className="results">
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
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
