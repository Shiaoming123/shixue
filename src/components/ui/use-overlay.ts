import { nextTick, onMounted, onUnmounted, toValue, useId, watch, type MaybeRefOrGetter, type Ref } from 'vue'

export type OverlayCloseReason = 'escape' | 'outside' | 'select'
export type OverlayKind = 'popover' | 'menu' | 'dialog' | 'sheet' | 'tooltip'

export interface OverlayRegistration {
  id: string
  kind: OverlayKind
  trigger: HTMLElement | null
  panel?: () => HTMLElement | null
  close(reason: OverlayCloseReason): void
}

const registrations = new Map<string, OverlayRegistration>()
const activeLayers: string[] = []
let listening = false
const isolatedElements = new Map<HTMLElement, { inert: string | null; ariaHidden: string | null }>()
let isolationObserver: MutationObserver | undefined

function syncModalIsolation() {
  const modal = modalLayer()
  const allowed = modal ? activeLayers.slice(activeLayers.indexOf(modal.id))
    .map((id) => registrations.get(id)?.panel?.()).filter((panel): panel is HTMLElement => Boolean(panel)) : []
  const isolated = new Set<HTMLElement>()
  function visit(element: HTMLElement) {
    if (allowed.includes(element)) return
    if (allowed.some((panel) => element.contains(panel))) {
      for (const child of Array.from(element.children)) if (child instanceof HTMLElement) visit(child)
    } else isolated.add(element)
  }
  if (allowed.length) for (const child of Array.from(document.body.children)) if (child instanceof HTMLElement) visit(child)

  for (const [element, previous] of isolatedElements) {
    if (isolated.has(element)) continue
    if (previous.inert === null) element.removeAttribute('inert')
    else element.setAttribute('inert', previous.inert)
    if (previous.ariaHidden === null) element.removeAttribute('aria-hidden')
    else element.setAttribute('aria-hidden', previous.ariaHidden)
    isolatedElements.delete(element)
  }
  // Move focus before aria-hiding its old ancestor; browsers reject hiding focused content.
  if (modal && !allowed.some((panel) => panel.contains(document.activeElement))) {
    const panel = modal.panel?.()
    if (panel) (focusableElements(panel)[0] ?? panel).focus({ preventScroll: true })
  }
  for (const element of isolated) {
    if (isolatedElements.has(element)) continue
    isolatedElements.set(element, { inert: element.getAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden') })
    element.setAttribute('inert', '')
    element.setAttribute('aria-hidden', 'true')
  }
  if (modal && typeof MutationObserver !== 'undefined') {
    isolationObserver ??= new MutationObserver(syncModalIsolation)
    isolationObserver.observe(document.body, { childList: true, subtree: true })
  } else isolationObserver?.disconnect()
}

function topLayer() {
  const id = activeLayers[activeLayers.length - 1]
  return id ? registrations.get(id) : undefined
}

export function hasActiveOverlay() { return activeLayers.length > 0 }

function modalLayer() {
  return [...activeLayers].reverse().map((id) => registrations.get(id))
    .find((layer) => layer?.kind === 'dialog' || layer?.kind === 'sheet')
}

function focusableElements(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]'))
    .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0)
}

export function focusNextToTrigger(trigger: HTMLElement | null, backwards: boolean) {
  if (!trigger) return
  const scope = trigger.closest<HTMLElement>('[data-overlay-layer]') ?? document.body
  const elements = focusableElements(scope)
  const index = elements.indexOf(trigger)
  const next = index + (backwards ? -1 : 1)
  const target = elements[next] ?? (scope === document.body ? trigger : elements[backwards ? elements.length - 1 : 0])
  ;(target ?? trigger).focus({ preventScroll: true })
}

function onFocusin(event: FocusEvent) {
  const modal = modalLayer()
  if (!modal || !(event.target instanceof Node)) return
  const index = activeLayers.indexOf(modal.id)
  if (activeLayers.slice(index).some((id) => document.querySelector(`[data-overlay-layer="${id}"]`)?.contains(event.target as Node))) return
  const panel = modal.panel?.()
  if (panel) (focusableElements(panel)[0] ?? panel).focus({ preventScroll: true })
}

function listen() {
  if (listening || typeof document === 'undefined') return
  document.addEventListener('keydown', onKeydown, true)
  document.addEventListener('focusin', onFocusin)
  document.addEventListener('pointerdown', onPointerdown, true)
  listening = true
}

function unlisten() {
  if (!listening || registrations.size) return
  document.removeEventListener('keydown', onKeydown, true)
  document.removeEventListener('focusin', onFocusin)
  document.removeEventListener('pointerdown', onPointerdown, true)
  listening = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab' && topLayer() === modalLayer()) {
    const panel = modalLayer()?.panel?.()
    if (panel) {
      const elements = focusableElements(panel)
      const first = elements[0] ?? panel
      const last = elements[elements.length - 1] ?? panel
      if (!elements.length || !panel.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
  }
  if (event.key !== 'Escape') return
  const registration = topLayer()
  if (!registration) return
  event.preventDefault()
  event.stopPropagation()
  releaseOverlay(registration.id, true)
  registration.close('escape')
}

/** Shared modal lifecycle for custom-shaped sheets and responsive drawers. */
export function useModalOverlay(open: MaybeRefOrGetter<boolean>, panel: Ref<HTMLElement | null>, close: () => void) {
  const registration: OverlayRegistration = {
    id: `modal-${useId()}`, kind: 'dialog', trigger: null, panel: () => panel.value, close,
  }
  const { layerId, bringToFront } = useOverlay(registration)
  watch(() => toValue(open), async (active, previous) => {
    if (active) {
      registration.trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      if (!toValue(open)) return
      bringToFront()
      const element = panel.value
      if (element) (element.querySelector<HTMLElement>('[autofocus]') ?? focusableElements(element)[0] ?? element).focus({ preventScroll: true })
    } else if (previous) releaseOverlay(layerId, true)
  }, { immediate: true })
  onUnmounted(() => {
    if (toValue(open)) queueMicrotask(() => registration.trigger?.focus({ preventScroll: true }))
  })
  return { layerId }
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
  syncModalIsolation()
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
      syncModalIsolation()
      listen()
    },
  }
}
