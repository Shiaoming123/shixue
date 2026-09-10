import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

class HostNode {
  children: HostNode[] = []
  parent: HostNode | null = null
  props: Record<string, any> = {}
  text = ''
  tagName: string
  constructor(tag = 'div') { this.tagName = tag.toUpperCase() }
}

const renderer = Vue.createRenderer<HostNode, HostNode>({
  createElement: (tag) => new HostNode(tag),
  createText: (value) => { const node = new HostNode('#text'); node.text = value; return node },
  createComment: () => new HostNode('#comment'),
  insert(child, parent, anchor) {
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(child)
    else parent.children.splice(index, 0, child)
  },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter((item) => item !== child) },
  setText(node, value) { node.text = value },
  setElementText(node, value) { node.text = value },
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  patchProp(node, key, _previous, value) { node.props[key] = value },
})

function compileComponent(name: string, modules: Record<string, unknown>) {
  const source = readFileSync(new URL(`../src/components/ui/${name}.vue`, import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const code = ts.transpileModule(compileScript(descriptor, { id: `contract-${name}`, inlineTemplate: true }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exported: any = {}
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'vue') return Vue
    const dependency = Object.entries(modules).find(([suffix]) => id.endsWith(suffix))?.[1]
    if (dependency) return dependency
    return {}
  }, exported)
  return exported.default
}

function find(node: HostNode, tag: string): HostNode | undefined {
  if (node.tagName === tag.toUpperCase()) return node
  return node.children.map((child) => find(child, tag)).find(Boolean)
}

function findByProp(node: HostNode, name: string, value: unknown): HostNode | undefined {
  if (node.props[name] === value) return node
  return node.children.map((child) => findByProp(child, name, value)).find(Boolean)
}

function invoke(node: HostNode, name: string, event: Record<string, unknown> = {}) {
  const handler = node.props[name]
  for (const callback of Array.isArray(handler) ? handler : [handler]) callback?.(event)
}

test('Tooltip delays pointer hover for 500ms, opens on focus, and closes on leave, blur, and Escape', async () => {
  const controls: { open?: () => boolean; close?: (reason: 'escape' | 'outside' | 'select') => void } = {}
  const Popover = Vue.defineComponent({
    props: { open: Boolean, kind: String, align: String, offset: Number },
    emits: ['update:open', 'close'],
    setup(props, { emit, slots }) {
      controls.open = () => props.open
      controls.close = (reason) => { emit('update:open', false); emit('close', reason) }
      const toggle = (event?: Event) => {
        assert.ok(event?.currentTarget, 'Popover receives the real trigger for positioning')
        emit('update:open', !props.open)
      }
      return () => Vue.h(Vue.Fragment, [
        slots.trigger?.({ open: props.open, toggle, triggerProps: {} }),
        props.open ? slots.default?.({ close: controls.close }) : null,
      ])
    },
  })
  const Tooltip = compileComponent('Tooltip', { '/Popover.vue': { default: Popover } })
  const Harness = Vue.defineComponent({
    setup: () => () => Vue.h(Tooltip, { label: '编辑任务', describedBy: 'existing-help' }, {
      trigger: ({ triggerProps }: any) => Vue.h('button', Vue.mergeProps({ 'aria-describedby': 'existing-help' }, triggerProps), '编辑'),
    }),
  })
  const root = new HostNode()
  const app = renderer.createApp(Harness)
  app.mount(root)
  const button = find(root, 'button')!

  invoke(button, 'onMouseenter', { currentTarget: button })
  await new Promise((resolve) => setTimeout(resolve, 450))
  assert.equal(controls.open?.(), false)
  invoke(button, 'onKeydown', { key: 'Escape' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  await Vue.nextTick()
  assert.equal(controls.open?.(), false, 'Escape cancels a pending hover timer')
  assert.equal(button.props['aria-describedby'], 'existing-help')

  invoke(button, 'onMouseenter', { currentTarget: button })
  await new Promise((resolve) => setTimeout(resolve, 550))
  await Vue.nextTick()
  assert.equal(controls.open?.(), true)
  const tooltip = findByProp(root, 'role', 'tooltip')
  assert.ok(tooltip, 'open Tooltip renders role=tooltip content')
  const describedBy = String(button.props['aria-describedby']).split(/\s+/)
  assert.ok(describedBy.includes('existing-help'))
  assert.ok(describedBy.includes(String(tooltip.props.id)), 'trigger references the rendered tooltip ID')

  invoke(button, 'onMouseleave')
  await Vue.nextTick()
  assert.equal(controls.open?.(), false)
  assert.equal(button.props['aria-describedby'], 'existing-help')

  invoke(button, 'onFocus', { currentTarget: button })
  await Vue.nextTick()
  assert.equal(controls.open?.(), true)
  invoke(button, 'onBlur')
  await Vue.nextTick()
  assert.equal(controls.open?.(), false)
  assert.equal(button.props['aria-describedby'], 'existing-help')

  invoke(button, 'onFocus', { currentTarget: button })
  await Vue.nextTick()
  invoke(button, 'onKeydown', { key: 'Escape' })
  await Vue.nextTick()
  assert.equal(controls.open?.(), false)
  assert.equal(button.props['aria-describedby'], 'existing-help')
  app.unmount()
})

test('IconButton requires a label, tracks caller attributes, and owns the visual contract', async () => {
  let tooltipLabel = ''
  let tooltipDescribedBy = ''
  let clicked = 0
  const Tooltip = Vue.defineComponent({
    props: { label: { type: String, required: true }, describedBy: String },
    setup(props, { slots }) {
      return () => {
        tooltipLabel = props.label
        tooltipDescribedBy = props.describedBy ?? ''
        return slots.trigger?.({ triggerProps: { 'data-tooltip-trigger': 'true' } })
      }
    },
  })
  const IconButton = compileComponent('IconButton', { '/Tooltip.vue': { default: Tooltip } })
  const describedBy = Vue.ref('existing-icon-help')
  const Harness = Vue.defineComponent({
    setup: () => () => Vue.h(IconButton, {
      label: '删除任务', variant: 'destructive', iconSize: 20, 'aria-describedby': describedBy.value, 'data-test': 'delete', onClick: () => { clicked += 1 },
    }, { default: () => Vue.h('svg') }),
  })
  const root = new HostNode()
  const app = renderer.createApp(Harness)
  app.mount(root)
  const button = find(root, 'button')!

  assert.equal(tooltipLabel, '删除任务')
  assert.equal(tooltipDescribedBy, 'existing-icon-help')
  assert.equal(button.props['aria-label'], '删除任务')
  assert.equal(button.props['aria-describedby'], 'existing-icon-help')
  assert.equal(button.props['data-test'], 'delete')
  assert.equal(button.props['data-tooltip-trigger'], 'true')
  assert.match(String(button.props.class), /icon-button--destructive/)
  invoke(button, 'onClick')
  assert.equal(clicked, 1)

  describedBy.value = 'updated-icon-help'
  await Vue.nextTick()
  assert.equal(tooltipDescribedBy, 'updated-icon-help')
  assert.equal(button.props['aria-describedby'], 'updated-icon-help')
  app.unmount()

  const source = readFileSync(new URL('../src/components/ui/IconButton.vue', import.meta.url), 'utf8')
  assert.match(source, /variant\?: 'quiet' \| 'standard' \| 'destructive'/)
  assert.match(source, /iconSize\?: 16 \| 18 \| 20/)
  assert.match(source, /inline-size: 44px;[\s\S]*block-size: 44px;/)
  assert.match(source, /IconButton requires a non-empty accessible label/)
})
