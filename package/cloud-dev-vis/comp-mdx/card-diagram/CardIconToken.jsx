import { observer } from 'mobx-react-lite';
import { Trash2 } from '../../../../main/frontend/UICommon.js';
import { cellTokenDefine } from '../../../../main/comp-doc/cell/cell-define.js';
import { slashActionDefine } from '../../../../main/comp-doc/slash/slash-define.js';
import { slashEffect } from '../../../../main/frontend/src/lib/doc-slash.js';
import { CARD_ICON_BY_NAME } from './CompactCard.jsx';
import { CARD_ICON_SIGIL, cardIconTextBuild, cardIconTextStrip, cardIconTokenBuild } from './CardIconTokenData.js';

// An icon in the text of a card (card-diagram-impl.md#icons-in-a-text): a token of the cell edit
// layer (doc_page_impl_edit_cell.md), so a text of a card holds icons among its words, typed in
// place like a link:
//
//   written    {{icon:database}} Source database      the names of CARD_ICON_BY_NAME
//   drawn      the icon, inline, at the size of the words around it
//   typed      /icon, or {{icon: (the menu lists the icons, the words typed narrow them)
//   changed    a click on it, in a text being edited: its card, another icon chosen or it taken out
//
// It is a kind of the cards' own (handed to useCell), not of the page: the icons are the package's.
export { CARD_ICON_SIGIL, cardIconTextBuild, cardIconTextStrip, cardIconTokenBuild };

export const cardIconNameList = Object.keys(CARD_ICON_BY_NAME);

const iconListOf = (words) => {
	const wordList = String(words ?? '').toLowerCase().split(/\s+/).filter(Boolean);
	return cardIconNameList.filter(name => wordList.every(word => name.includes(word)));
};

// /icon: the icons, the words typed narrowing them; one chosen is written where the slash was
const cardIconSlashAction = slashActionDefine({
	name: 'icon',
	label: 'Icon',
	description: 'an icon among the words',
	icon: CARD_ICON_BY_NAME.boxes,
	param: {
		placeholder: 'the name of an icon: database, server, file …',
		emptyText: 'No icon has this name',
		itemListGet: param => iconListOf(param).map(name => ({ id: name, label: name, name })),
		itemChoose: item => slashEffect.replace(cardIconTokenBuild(item.name)),
		ItemRender: ({ item }) => {
			const Icon = CARD_ICON_BY_NAME[item.name];
			return <span className="doc-card-icon-token-item"><Icon size={14} aria-hidden="true" /><span>{item.name}</span></span>;
		},
	},
});

// the card of an icon in a text being edited: another icon, or none
const CardIconTokenCard = observer(function CardIconTokenCard({ token, tokenSet }) {
	return (
		<div className="doc-card-icon-token-card">
			<div className="doc-card-icon-token-grid" role="listbox" aria-label="Icons">
				{cardIconNameList.map((name) => {
					const Icon = CARD_ICON_BY_NAME[name];
					const isCurrent = name === token.data.name;
					return <button key={name} type="button" role="option" aria-selected={isCurrent} className={`doc-button-icon${isCurrent ? ' is-current' : ''}`} title={name} onClick={() => tokenSet({ body: name })}><Icon size={15} aria-hidden="true" /></button>;
				})}
			</div>
			<button type="button" className="doc-button is-danger doc-card-icon-token-remove" onClick={() => tokenSet(null)}><Trash2 size={12} aria-hidden="true" />Take it out</button>
		</div>
	);
});

export const cardIconToken = cellTokenDefine({
	name: 'icon',
	label: 'Icon',
	description: 'an icon among the words: {{icon:database}}',
	brace: { sigil: CARD_ICON_SIGIL },
	// a name that is no icon stays text as written
	read: body => (CARD_ICON_BY_NAME[body] ? { name: body } : undefined),
	// an icon has no words
	textGet: () => '',
	Render: function CardIconTokenRender({ token }) {
		const Icon = CARD_ICON_BY_NAME[token.data.name];
		return <Icon className="doc-card-icon-token" size="1.15em" aria-label={token.data.name} role="img" />;
	},
	slashAction: cardIconSlashAction,
	Card: CardIconTokenCard,
});
