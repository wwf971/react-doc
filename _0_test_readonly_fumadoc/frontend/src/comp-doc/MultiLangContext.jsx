import { createContext, useContext } from 'react';

const MultiLangContext = createContext('');

export function DocLanguageProvider({ children, language }) {
  const languageAncestor = useContext(MultiLangContext);
  const languageOwn = languageNormalize(language);
  return (
    <MultiLangContext.Provider value={languageOwn || languageAncestor}>
      {children}
    </MultiLangContext.Provider>
  );
}

export function useDocLanguage() {
  return useContext(MultiLangContext);
}

function languageNormalize(language) {
  return typeof language === 'string' ? language.trim() : '';
}