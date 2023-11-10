import './styles.css'

import { EditorThemeClasses } from 'lexical'

export const RichTextEditorTheme: EditorThemeClasses = {
  list: {
    listitem: 'rte-list-item',
    nested: {
      listitem: 'rte-nested-list-item',
    },
    olDepth: ['rte-ol', 'rte-nested-ol'],
  },
  link: 'rte-link',
  text: {
    underline: 'rte-underline',
  },
  heading: {
    h1: 'rte-h1',
    h2: 'rte-h2',
    h3: 'rte-h3',
    h4: 'rte-h4',
    h5: 'rte-h5',
    h6: 'rte-h6',
  },
}
