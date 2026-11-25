<script setup lang="ts">
import { Bold, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered, Quote } from '@lucide/vue'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import type { Component } from 'vue'

/** Éditeur de texte mis en forme. La valeur est du HTML ; une chaîne vide quand il n'y a pas de texte. */
const props = defineProps<{
  modelValue?: string | null
  /** Options de mise en forme autorisées. Absent : toutes sauf l'image. */
  features?: readonly string[]
  invalid?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const has = (feature: string) => !props.features || props.features.includes(feature)
const on = (feature: string) => (has(feature) ? {} : false) as any
const html = (e: { isEmpty: boolean; getHTML: () => string }) => (e.isEmpty ? '' : e.getHTML())

const editor = useEditor({
  content: props.modelValue ?? '',
  extensions: [
    StarterKit.configure({
      heading: has('heading') ? { levels: [2, 3] } : false,
      bold: on('bold'),
      italic: on('italic'),
      bulletList: on('list'),
      orderedList: on('list'),
      listItem: on('list'),
      blockquote: on('quote'),
      link: has('link') ? { openOnClick: false, autolink: true } : false,
      // Hors du format : ces mises en forme ne sont pas conservées à l'enregistrement.
      code: false, codeBlock: false, strike: false, underline: false, horizontalRule: false,
    }),
  ],
  onUpdate: ({ editor }) => emit('update:modelValue', html(editor)),
})

// Changement venu de l'extérieur (chargement, copie depuis une autre langue).
watch(() => props.modelValue, (value) => {
  if (editor.value && (value ?? '') !== html(editor.value)) editor.value.commands.setContent(value ?? '', { emitUpdate: false })
})
onBeforeUnmount(() => editor.value?.destroy())

function setLink() {
  const chain = editor.value!.chain().focus().extendMarkRange('link')
  const url = prompt('Adresse du lien (laisser vide pour le retirer)', editor.value!.getAttributes('link').href ?? 'https://')
  if (url === null) return
  if (url.trim() === '' || url.trim() === 'https://') chain.unsetLink().run()
  else chain.setLink({ href: url.trim() }).run()
}

const buttons = computed(() => {
  const e = editor.value
  if (!e) return []
  return [
    has('bold') && { icon: Bold, title: 'Gras', active: e.isActive('bold'), run: () => e.chain().focus().toggleBold().run() },
    has('italic') && { icon: Italic, title: 'Italique', active: e.isActive('italic'), run: () => e.chain().focus().toggleItalic().run() },
    has('heading') && { icon: Heading2, title: 'Titre de section (H2)', active: e.isActive('heading', { level: 2 }), run: () => e.chain().focus().toggleHeading({ level: 2 }).run() },
    has('heading') && { icon: Heading3, title: 'Sous-titre (H3)', active: e.isActive('heading', { level: 3 }), run: () => e.chain().focus().toggleHeading({ level: 3 }).run() },
    has('list') && { icon: List, title: 'Liste à puces', active: e.isActive('bulletList'), run: () => e.chain().focus().toggleBulletList().run() },
    has('list') && { icon: ListOrdered, title: 'Liste numérotée', active: e.isActive('orderedList'), run: () => e.chain().focus().toggleOrderedList().run() },
    has('quote') && { icon: Quote, title: 'Citation', active: e.isActive('blockquote'), run: () => e.chain().focus().toggleBlockquote().run() },
    has('link') && { icon: LinkIcon, title: 'Ajouter ou retirer un lien', active: e.isActive('link'), run: setLink },
  ].filter(Boolean) as { icon: Component; title: string; active: boolean; run: () => void }[]
})
</script>

<template>
  <div class="cms-rich border rounded-field overflow-hidden focus-within:border-primary" :class="invalid ? 'border-error' : 'border-base-300'">
    <div class="flex flex-wrap gap-0.5 p-1 border-b border-base-300 bg-base-200">
      <button
        v-for="b in buttons" :key="b.title" type="button" class="btn btn-xs btn-square" :class="b.active ? 'btn-neutral' : 'btn-ghost'"
        :title="b.title" :aria-label="b.title" @mousedown.prevent="b.run()"
      >
        <component :is="b.icon" :size="15" />
      </button>
    </div>
    <EditorContent :editor="editor" />
  </div>
</template>
