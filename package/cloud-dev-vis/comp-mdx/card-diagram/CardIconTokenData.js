// The text of an icon in a text of a card (CardIconToken.jsx), without React: what a generator
// writes and what a search reads. An icon is the token {{icon:NAME}}, NAME one of CARD_ICON_BY_NAME.
export const CARD_ICON_SIGIL = 'icon:';

// the token of an icon as written
export const cardIconTokenBuild = (name) => `{{${CARD_ICON_SIGIL}${name}}}`;

// a text with an icon before its words: `{{icon:database}} Source database`
export const cardIconTextBuild = (name, text = '') => (name ? `${cardIconTokenBuild(name)}${text ? ` ${text}` : ''}` : text);

// a text without its icons: its words (a search, a title)
export const cardIconTextStrip = (text) => String(text ?? '').replace(/\{\{icon:[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();
