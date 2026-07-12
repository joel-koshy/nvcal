import { render } from 'preact'
import './index.css'
import { App } from './app.tsx'
import type { NvCalState } from './types/ui.ts';

// TODO Remove MOCK EVENTS in produciton
import { MOCK_EVENTS } from './mock/events.ts';

const stateNode = document.getElementById('initial-state');
const initialState: NvCalState = stateNode
  ? JSON.parse(stateNode.textContent || '{}')
  : { events: MOCK_EVENTS, authenticated: false, user: null }
console.log(initialState)


render(<App initialData={initialState} />, document.getElementById('app')!)
