import { useCallback, useEffect, useState } from 'react'
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  REMOVE_LIST_COMMAND,
} from '@lexical/list'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $findMatchingParent, $getNearestNodeOfType } from '@lexical/utils'
import {
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
} from 'lexical'

/* Prevent button clicks from causing ContentEditable to unfocus */
const ToolbarButton = ({
  command,
  children,
}: {
  command: () => void
  children: any
}): JSX.Element => {
  return (
    <button
      className="rte-toolbar-button"
      onClick={command}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}

export const ToolbarPlugin = (): JSX.Element => {
  const [editor] = useLexicalComposerContext()
  const [nodeType, setNodeType] = useState('paragraph')
  const [isLink, setIsLink] = useState(false)
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)
  const [isStrikethrough, setIsStrikethrough] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const $updateToolbar = useCallback(() => {
    const selection = $getSelection()

    if ($isRangeSelection(selection)) {
      const anchorNode = selection.anchor.getNode()
      const element =
        anchorNode.getKey() === 'root'
          ? anchorNode
          : $findMatchingParent(anchorNode, (node) => {
              const parent = node.getParent()
              return parent !== null && $isRootOrShadowRoot(parent)
            })

      console.log(anchorNode, element)
      // Update text format
      setIsBold(selection.hasFormat('bold'))
      setIsItalic(selection.hasFormat('italic'))
      setIsUnderline(selection.hasFormat('underline'))
      setIsStrikethrough(selection.hasFormat('strikethrough'))

      if ($isListNode(element)) {
        const parentList = $getNearestNodeOfType<ListNode>(anchorNode, ListNode)
        const type = parentList
          ? parentList.getListType()
          : element.getListType()
        setNodeType(type)
      }
    }
  }, [])

  const toggleUnorderedList = (nodeType: string) => {
    if (nodeType !== 'bullet') {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
    } else {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)
    }
  }

  const toggleOrderedList = (nodeType: string) => {
    if (nodeType !== 'number') {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
    } else {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)
    }
  }

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        $updateToolbar()
        return false
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor, $updateToolbar])

  return (
    <div className="rte-toolbar">
      <ToolbarButton
        command={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
      >
        bold
      </ToolbarButton>
      <ToolbarButton
        command={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
      >
        italic
      </ToolbarButton>
      <ToolbarButton
        command={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
      >
        underline
      </ToolbarButton>
      <ToolbarButton command={() => toggleUnorderedList(nodeType)}>
        ul
      </ToolbarButton>
      <ToolbarButton command={() => toggleOrderedList(nodeType)}>
        ol
      </ToolbarButton>
      <ToolbarButton
        command={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
      >
        undo
      </ToolbarButton>
      <ToolbarButton
        command={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
      >
        redo
      </ToolbarButton>
    </div>
  )
}
