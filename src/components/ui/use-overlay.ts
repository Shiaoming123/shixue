import { onMounted, onUnmounted } from 'vue'

export type OverlayCloseReason = 'escape' | 'outside' | 'select'
export type OverlayKind = 'popover' | 'menu' | 'dialog' | 'sheet' | 'tooltip'

export interface OverlayRegistration {
  id: string
  kind: OverlayKind
  trigger: HTMLElement | null
  close(reason: OverlayCloseReason): void
}

const registrations = new Map<string, OverlayRegistration>()
const activeLayers: string[] = []
let listening = false

function topLayer() {
  const id = activeLayers[activeLayers.length - 1]
  return id ? registrations.get(id) : undefined
}

function listen() {
  if (listening || typeof document === 'undefined') return
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onPointerdown, true)
  listening = true
}

function unlisten() {
  if (!listening || registrations.size) return
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onPointerdown, true)
  listening = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  const registration = topLayer()
  if (!registration) return
  event.preventDefault()
  event.stopPropagation()
  releaseOverlay(registration.id, true)
  registration.close('escape')
}

function onPointerdown(event: PointerEvent) {
  const registration = topLayer()
  if (!registration) return
  const target = event.target
  const path = event.composedPath()
  const insideLayer = path.some(
    (node) => node instanceof HTMLElement && node.dataset.overlayLayer === registration.id,
  )
  const insideTrigger = target instanceof Node && registration.trigger?.contains(target)
  if (insideLayer || insideTrigger) return
  releaseOverlay(registration.id)
  registration.close('outside')
}

export function releaseOverlay(layerId: string, restoreFocus = false) {
  for (let index = activeLayers.length - 1; index >= 0; index -= 1) {
    if (activeLayers[index] === layerId) activeLayers.splice(index, 1)
  }
  if (!restoreFocus) return
  const trigger = registrations.get(layerId)?.trigger
  queueMicrotask(() => trigger?.focus({ preventScroll: true }))
}

export function useOverlay(registration: OverlayRegistration): {
  layerId: string
  bringToFront(): void
} {
  const layerId = registration.id

  onMounted(() => {
    registrations.set(layerId, registration)
    listen()
  })

  onUnmounted(() => {
    releaseOverlay(layerId)
    registrations.delete(layerId)
    unlisten()
  })

  return {
    layerId,
    bringToFront() {
      registrations.set(layerId, registration)
      releaseOverlay(layerId)
      activeLayers.push(layerId)
      listen()
    },
  }
}
