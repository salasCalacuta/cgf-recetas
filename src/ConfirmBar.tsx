import { useEffect, useState } from 'react'

type Props = {
  dirty: boolean
  groupName: string
  onAccept: () => void
  onCancel: () => void
}

export function ConfirmBar({ dirty, groupName, onAccept, onCancel }: Props) {
  const [choice, setChoice] = useState<'accept' | 'cancel' | ''>('')

  useEffect(() => {
    if (!dirty) setChoice('')
  }, [dirty])

  if (!dirty) return null

  return (
    <div className="confirmBar">
      <div className="confirmBarTitle">Confirmaci\u00f3n de cambios</div>
      <p className="muted confirmBarHint">
        Marc\u00e1 una opci\u00f3n y puls\u00e1 <strong>Ejecutar</strong> para aplicar o descartar lo cargado o editado en esta
        pantalla.
      </p>
      <div className="confirmBarRadios">
        <label>
          <input
            type="radio"
            name={`confirm-${groupName}`}
            checked={choice === 'accept'}
            onChange={() => setChoice('accept')}
          />
          Aceptar y guardar (s\u00ed)
        </label>
        <label>
          <input
            type="radio"
            name={`confirm-${groupName}`}
            checked={choice === 'cancel'}
            onChange={() => setChoice('cancel')}
          />
          Cancelar y deshacer (no)
        </label>
      </div>
      <button
        type="button"
        className="button"
        disabled={!choice}
        onClick={() => {
          if (choice === 'accept') onAccept()
          if (choice === 'cancel') onCancel()
          setChoice('')
        }}
      >
        Ejecutar
      </button>
    </div>
  )
}
