import { observer } from 'mobx-react-lite';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
} from '../../UICommon.js';
import { useDocStores } from '../store/context.js';

// search dialog: fumadocs ui parts + our client-side matcher in the stores
// (structured data extracted per doc, no server needed).
export const DocSearchDialog = observer(function DocSearchDialog({ open, onOpenChange }) {
  const { docStore } = useDocStores();

  return (
    <SearchDialog
      open={open}
      onOpenChange={onOpenChange}
      search={docStore.searchQuery}
      onSearchChange={(value) => docStore.setSearchQuery(value)}
      isLoading={docStore.isSearchRunning}
      onSelect={(item) => {
        if (!item.url) return;
        docStore.navigate(item.url);
        onOpenChange(false);
      }}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput placeholder="Search docs" />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={docStore.searchQuery !== '' ? docStore.searchResults : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
});
