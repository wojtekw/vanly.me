import React from 'react';
import {createRoot} from 'react-dom/client';
import {PanelApp} from '../../../packages/ui/PanelApp';
import '../../../packages/ui/styles.css';
createRoot(document.getElementById('root')!).render(<PanelApp kind='admin'/>);
