import { createRoot } from 'react-dom/client';
import { configDoc, fileManifest } from 'virtual:doc-source';
import { DocApp } from './DocApp.jsx';
import './style.css';

// standalone entry: doc source collected by the vite plugin from config.yaml
createRoot(document.getElementById('root')).render(
  <DocApp sourceData={{ configDoc, fileManifest }} />,
);
