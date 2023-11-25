import { CodeNode } from '@lexical/code'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import { TRANSFORMERS } from '@lexical/markdown'
import ClickableLinkPlugin from '@lexical/react/LexicalClickableLinkPlugin'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'

import { AutoLinkWithMatchersPlugin } from './AutoLinkWithMatchersPlugin'
import { ListMaxIndentLevelPlugin } from './ListMaxIndentPlugin'
import { RichTextEditorTheme } from './RichTextEditorTheme'
import { ToolbarPlugin } from './ToolbarPlugin'

const EditorNodes = [
  ListNode,
  ListItemNode,
  HeadingNode,
  QuoteNode,
  CodeNode,
  LinkNode,
  AutoLinkNode,
]

const onError = (err: Error) => {
  console.error(err)
}

export const RichTextEditor = (): JSX.Element => {
  const initialConfig = {
    namespace: 'RichTextEditor',
    theme: RichTextEditorTheme,
    onError,
    nodes: [...EditorNodes],
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ToolbarPlugin />
      <RichTextPlugin
        contentEditable={<ContentEditable className="rte" spellCheck={false} />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <HistoryPlugin />
      <LinkPlugin />
      <ListPlugin />
      <TabIndentationPlugin />
      <AutoLinkWithMatchersPlugin />
      <ClickableLinkPlugin />
      <ListMaxIndentLevelPlugin maxDepth={2} />
    </LexicalComposer>
  )
}
