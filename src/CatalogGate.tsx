type PreviewProduct = {
  id: string
  code: string
  description: string
  unit: string
}

type CatalogGatePending = {
  rows: Array<{
    product: PreviewProduct
    packageQtyText: string
    baseUnitPrice: number
  }>
  count: number
} | null

type Props = {
  importMsg: string
  pendingImport: CatalogGatePending
  fileInputId: string
  priceListNumber: number
  formatMoney: (n: number) => string
  parsePackageQty: (raw: string) => number | null
  filterNumericQty: (raw: string) => string
  onPendingRowChange: (rowIndex: number, packageQtyText: string) => void
  onPickFile: (file: File) => void
  onConfirmImport: () => void
  onCancelImport: () => void
  onLogout: () => void
}

export function CatalogGate({
  importMsg,
  pendingImport,
  fileInputId,
  priceListNumber,
  formatMoney,
  parsePackageQty,
  filterNumericQty,
  onPendingRowChange,
  onPickFile,
  onConfirmImport,
  onCancelImport,
  onLogout,
}: Props) {
  return (
    <div className="page appShell catalogGatePage">
      <div className="screenWatermark" aria-hidden>
        <img src={`${import.meta.env.BASE_URL}logoCGF.png`} alt="" />
      </div>
      <header className="header headerBrandOnly">
        <div className="brand">
          <img className="logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
          <div className="brandText">
            <div className="title">Costos fùrmula</div>
          </div>
        </div>
        <button className="button secondary logoutBtn" type="button" onClick={onLogout}>
          Salir
        </button>
      </header>

      <main className="content contentStacked catalogGateMain">
        <section className="card catalogGateCard">
          <h2 className="catalogGateTitle">Catùlogo de productos</h2>
          <p className="muted">
            Es la primera sesiùn o aùn no hay productos guardados en este equipo. Importù el archivo exportado desde
            ODBC (listas de precios en formato <strong>.prn</strong>, <strong>.dat</strong>, <strong>.txt</strong> o{' '}
            <strong>.csv</strong> con columnas separadas por tabuladores, segùn corresponda).
          </p>
          <p className="muted">
            Si ya trabajaste antes en otro equipo, podùs traer el mismo archivo o una versiùn nueva: al volver a
            importar desde <strong>Productos</strong>, los cùdigos que coincidan se actualizan, los nuevos se agregan y
            el resto del catùlogo local se mantiene igual.
          </p>

          <div className="catalogGateActions">
            <input
              id={fileInputId}
              className="fileInput"
              type="file"
              accept=".prn,.txt,.dat,.csv,text/csv,text/plain,application/octet-stream"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onPickFile(f)
                e.currentTarget.value = ''
              }}
            />
            <label className="button" htmlFor={fileInputId}>
              Elegir archivo ODBCù
            </label>
          </div>

          {importMsg ? <div className="importMsg">{importMsg}</div> : null}

          {pendingImport ? (
            <>
              <div className="importPreviewWrap">
                <p className="muted" style={{ marginBottom: 10 }}>
                  Lista de importaciùn (lista de precios activa: {priceListNumber}). Columna Cantidad: solo nùmeros
                  (coma o punto decimal). Si queda vacùa, en la lista activa se guarda el precio importado. Si hay una
                  cantidad vùlida mayor a 0, en la lista activa se guarda precio importado ù cantidad.
                </p>
                <div className="table importPreviewTable">
                  <div className="row rowImportPreview head">
                    <div>Cùdigo</div>
                    <div>Descripciùn</div>
                    <div>Unidad de medida</div>
                    <div>Precio unitario</div>
                    <div>Cantidad</div>
                  </div>
                  {pendingImport.rows.map((row, idx) => {
                    const divisor = parsePackageQty(row.packageQtyText)
                    const displayUnit =
                      divisor !== null && divisor > 0 ? row.baseUnitPrice / divisor : row.baseUnitPrice
                    return (
                      <div className="row rowImportPreview" key={row.product.id}>
                        <div>{row.product.code}</div>
                        <div>{row.product.description}</div>
                        <div>{row.product.unit || '-'}</div>
                        <div>{formatMoney(displayUnit)}</div>
                        <div>
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={row.packageQtyText}
                            onChange={(e) => onPendingRowChange(idx, filterNumericQty(e.target.value))}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="catalogGateFooter">
                <button className="button secondary" type="button" onClick={onCancelImport}>
                  Descartar archivo
                </button>
                <button className="button" type="button" onClick={onConfirmImport}>
                  Confirmar y guardar catùlogo
                </button>
              </div>
            </>
          ) : null}
        </section>
      </main>
    </div>
  )
}
