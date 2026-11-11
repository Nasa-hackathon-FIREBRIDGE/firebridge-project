import { Crosshair, Layers2, Map, Maximize, Minimize, Minus, Pentagon, Plus, RectangleHorizontal, RotateCcw, Trash2, X, ListFilter } from 'lucide-react'
import type { BasemapChoice, BasemapSelection } from '../basemap'
import { useRef } from 'react'

export type DrawShape = 'rectangle' | 'polygon'

export function MapWorkspaceControls({ panel, onPanel, choice, onChoice, selection, configured,
  drawActive, onDraw, onClear, onZoom, onFit, onNorth, onFullscreen, fullscreen,
  showArea, onShowArea, showDetections, onShowDetections, showBasemap, onShowBasemap,
  apiMode, recordMode, atlasMode = false, promptDraw = false,
}: {
  panel: 'layers' | 'basemap' | 'legend' | null; onPanel: (panel: 'layers' | 'basemap' | 'legend' | null) => void
  choice: BasemapChoice; onChoice: (choice: BasemapChoice) => void; selection: BasemapSelection; configured: boolean
  drawActive: boolean; onDraw: (shape: DrawShape) => void; onClear: () => void; onZoom: (amount: number) => void
  onFit: () => void; onNorth: () => void; onFullscreen: () => void; fullscreen: boolean
  showArea: boolean; onShowArea?: (visible: boolean) => void; showDetections: boolean; onShowDetections?: (visible: boolean) => void
  showBasemap: boolean; onShowBasemap: (visible: boolean) => void; apiMode: boolean; recordMode: boolean; atlasMode?: boolean
  promptDraw?: boolean
}) {
  const basemapButton = useRef<HTMLButtonElement>(null)
  const layersButton = useRef<HTMLButtonElement>(null)
  const legendButton = useRef<HTMLButtonElement>(null)
  const toggle = (value: 'layers' | 'basemap' | 'legend') => onPanel(panel === value ? null : value)
  const close = () => {
    const target = panel === 'layers' ? layersButton : panel === 'legend' ? legendButton : basemapButton
    onPanel(null)
    requestAnimationFrame(() => target.current?.focus())
  }
  return <>
    <div className="map-context-controls" aria-label="Map display controls" data-map-choice={choice}>
      <button ref={basemapButton} type="button" aria-label="Choose basemap" aria-expanded={panel === 'basemap'} title="Choose basemap" onClick={() => toggle('basemap')}><Map size={15} /><span>{selection.label}</span></button>
      <button ref={layersButton} type="button" aria-label="Map layers" aria-expanded={panel === 'layers'} title="Map layers" onClick={() => toggle('layers')}><Layers2 size={15} /><span>Layers</span></button>
      <button ref={legendButton} type="button" aria-label="Map layer legend" aria-expanded={panel === 'legend'} title="Map legend" onClick={() => toggle('legend')}><ListFilter size={15} /></button>
    </div>
    {panel && <aside className="map-context-panel" aria-label={panel === 'basemap' ? 'Basemap choices' : panel === 'layers' ? 'Map layer controls' : 'Map legend'} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <header><strong>{panel === 'basemap' ? 'Background map' : panel === 'layers' ? 'Visible layers' : 'Map legend'}</strong><button className="icon-button" type="button" aria-label="Close map panel" onClick={close}><X size={15} /></button></header>
      {panel === 'basemap' ? <>
        <label className="map-control-label">Basemap<select aria-label="Basemap" value={choice} onChange={(event) => onChoice(event.target.value as BasemapChoice)}>
          {configured && <option value="configured">Configured provider</option>}
          <option value="satellite">Satellite · NASA Blue Marble</option><option value="hybrid">Satellite + labels · NASA / OSM</option><option value="streets">Streets · OpenStreetMap</option><option value="relief">Shaded relief · NASA</option><option value="schematic">Offline coordinate grid</option>
        </select></label><p>{selection.description}</p><p className="map-context-caveat">Background context only. It does not change or date-match the wildfire observation records.</p>
      </> : panel === 'layers' ? <>
        <label className="map-layer-row"><input type="checkbox" checked={showBasemap} onChange={(event) => onShowBasemap(event.target.checked)} /><span><strong>{selection.label}</strong><small>Geographic context · independent imagery dates</small></span></label>
        <label className="map-layer-row"><input type="checkbox" checked={showDetections} disabled={!onShowDetections} onChange={(event) => onShowDetections?.(event.target.checked)} /><span><strong>{apiMode ? 'Native wildfire detections' : 'Synthetic demonstration records'}</strong><small>{apiMode ? atlasMode ? 'Every detection · fire atlas lenses' : recordMode ? 'Loaded server pages only' : 'Saved analysis · aggregated MVT' : 'Local fixtures · not satellite observations'}</small></span></label>
        <label className="map-layer-row"><input type="checkbox" checked={showArea} disabled={!onShowArea} onChange={(event) => onShowArea?.(event.target.checked)} /><span><strong>Study area boundary</strong><small>WGS 84 · user-provided geometry</small></span></label>
      </> : <div className="map-context-legend"><span><i className="legend-dot legend-viirs" />{apiMode ? atlasMode ? 'Native detections · styled by the lens below the map' : recordMode ? 'Loaded native record' : 'Aggregated records · size = count' : 'VIIRS synthetic record'}</span>{!apiMode && <span><i className="legend-dot legend-modis" />MODIS synthetic record</span>}<span><i className="legend-dot legend-selected" />Selected record</span><span><i className="legend-line" />Study area boundary</span><p>Detection records do not identify unique confirmed fire incidents.</p></div>}
    </aside>}

    {/* Navigation: top-right, icon buttons with hover labels */}
    <div className="map-actions map-nav" aria-label="Map controls">
      <button type="button" className="map-icon-button" aria-label="Zoom in" data-tip="Zoom in" onClick={() => onZoom(1)}><Plus size={16} /></button>
      <button type="button" className="map-icon-button" aria-label="Zoom out" data-tip="Zoom out" onClick={() => onZoom(-1)}><Minus size={16} /></button>
      <span className="map-control-separator" />
      <button type="button" className="map-icon-button" aria-label={apiMode ? 'Fit study area' : 'Return to northern Morocco'} data-tip={apiMode ? 'Fit study area' : 'Back to study area'} onClick={onFit}><Crosshair size={16} /></button>
      <button type="button" className="map-icon-button" aria-label="Reset map orientation" data-tip="Reset north" onClick={onNorth}><RotateCcw size={16} /></button>
      <button type="button" className="map-icon-button" aria-label={fullscreen ? 'Exit fullscreen map' : 'Fullscreen map'} data-tip={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={onFullscreen}>{fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}</button>
    </div>

    {/* Drawing: bottom-centre, labelled. Replaced by the drawing bar while a shape is in progress. */}
    {!drawActive && (
      <div className="map-draw-toolbar" role="group" aria-label="Draw a study area" data-prompt={promptDraw || undefined}>
        {promptDraw && <span className="map-draw-prompt">Start here · draw your study area</span>}
        <button type="button" className="map-draw-tool" aria-label="Draw rectangle" onClick={() => { onPanel(null); onDraw('rectangle') }}><RectangleHorizontal size={16} aria-hidden="true" />Rectangle</button>
        <button type="button" className="map-draw-tool" aria-label="Draw polygon" onClick={() => { onPanel(null); onDraw('polygon') }}><Pentagon size={16} aria-hidden="true" />Polygon</button>
        <span className="map-control-separator" aria-hidden="true" />
        <button type="button" className="map-draw-tool map-draw-tool--icon" aria-label="Clear selected area" data-tip="Clear area" onClick={onClear}><Trash2 size={16} aria-hidden="true" /></button>
      </div>
    )}
  </>
}
