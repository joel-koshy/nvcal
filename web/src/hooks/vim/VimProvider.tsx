import { createContext, } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

type Direction = 'left' | 'right' | 'up' | 'down';
type Flow = 'row' | 'col'

export interface PaneConfig {
  cols: number; 
  neighbors: Partial<Record<Direction,string>>; 
  flow: Flow; 
} 

interface PaneData{
  config: PaneConfig; 
  nodes: Set<HTMLElement> 
  coordinateMap: Map<string, HTMLElement> ; 
  reverseMap: Map<HTMLElement, {x: number, y:number}>; 
  isDirty: boolean;
}

interface VimContextProps{
  activePane: string; 
  setActivePane: (pane: string) => void; 
  registerPane: (name: string, config: PaneConfig) => void;
  unregisterPane: (name: string) => void;
  registerNode: (paneName: string, node: HTMLElement) => void;
  unregisterNode: (paneName: string, node: HTMLElement) => void;
}

export const VimContext = createContext<VimContextProps | null>(null)

const getSortedNodes = (nodes: Set<HTMLElement>): HTMLElement[] => {
  return Array.from(nodes).sort((a, b) => {
    if ( a == b) return 0; 
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1; 
  })
}

interface VimProviderProps {
  children: ComponentChildren; 
  initialPane?: string
}
export function VimProvider({children, initialPane = 'main'}: VimProviderProps){
  const registry = useRef(new Map<string, PaneData>(new Map())); 
  const [activePane, setActivePane] = useState(initialPane);  
  const registerPane = (name: string, config: PaneConfig) => {
    if(!registry.current.has(name)){
      registry.current.set(name, {
        config, nodes: new Set(),
        coordinateMap: new Map(),
        reverseMap: new Map(),
        isDirty: true,
      }); 
    }else{
      registry.current.get(name)!.config = config; 
    }
  };
  const unregisterPane = (name: string) => {
    registry.current.delete(name);
  }
  const registerNode = (paneName: string, node: HTMLElement) => {
    if (!registry.current.has(paneName)) {
      registry.current.set(paneName, { 
        config: { cols: 1, flow: 'row', neighbors: {} }, 
        nodes: new Set(), 
        coordinateMap: new Map(),
        reverseMap: new Map(),
        isDirty: true,
      });
    }
    const pane = registry.current.get(paneName)!;
    pane.nodes.add(node);
    pane.isDirty = true; 
  };

  const unregisterNode = (paneName: string, node: HTMLElement) => {
    const pane = registry.current.get(paneName); 
    if (pane) {
      pane.nodes.delete(node);
      pane.isDirty = true;
    }
  }
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement; 
      // Escape from Input Fields
      if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement){
        if (e.key == 'Escape') activeEl.blur(); 
        return; 
      }
      const currentPaneData = registry.current.get(activePane); 
      if(!currentPaneData) return ;
  
      let dir: Direction | null = null ;
      let changeX = 0; 
      let changeY = 0; 
      const isMacro = e.shiftKey; 
      switch (e.key) {
          case 'H':
            dir = 'left'
            break;
          case 'L':  
            dir = 'right'
            break;
          case 'J':  
            dir = 'down'
            break;
          case 'K':   
            dir = 'up'
            break;
          case 'h': 
            changeX -= 1; 
            break;
          case 'l': 
            changeX += 1; 
            break; 
          case 'k': 
            changeY -= 1; 
            break;  
          case 'j': 
            changeY += 1; 
            break; 
          default: 
            return; 
      }
      e.preventDefault(); 

      // Pane Navigation 
      if(isMacro && dir && currentPaneData.config.neighbors){
        const targetPaneName = currentPaneData.config.neighbors[dir];
        if(targetPaneName && registry.current.has(targetPaneName)){
          console.log("Hit")
          setActivePane(targetPaneName); 
          // TODO set to last selected node 
          const targetNodes = getSortedNodes(registry.current.get(targetPaneName)!.nodes); 
          if (targetNodes.length > 0) targetNodes[0].focus(); 
        }
        return; 
      }

      // Inner Navigation 
      if(changeX !== 0 || changeY !== 0){
        if(currentPaneData.isDirty){
          const nodes = getSortedNodes(currentPaneData.nodes); 
          if (nodes.length == 0) return; 

          const {cols, flow} = currentPaneData.config;
          currentPaneData.coordinateMap.clear(); 
          currentPaneData.reverseMap.clear(); 
          const rows = Math.ceil(nodes.length / cols);
          nodes.forEach((node, index) => {
            let x, y; 
            if (flow == 'row'){
              x = index % cols; 
              y = Math.floor(index/cols);
            }else{
              y = index % rows; 
              x = Math.floor(index/rows);
            }
            currentPaneData.coordinateMap.set(`${x},${y}`, node); 
            currentPaneData.reverseMap.set(node, {x, y}); 
          })
          currentPaneData.isDirty = false; 
        }
      }

      const currentCoords = currentPaneData.reverseMap.get(activeEl); 
      if(!currentCoords){
        const fallback = currentPaneData.coordinateMap.get('0,0'); 
        if(fallback)  fallback.focus(); 
        return ;
      }

      let targetX = currentCoords.x + changeX; 
      let targetY = currentCoords.y + changeY; 
      const { cols, flow } = currentPaneData.config;
      if(flow == 'row'){
        if (targetX >= cols) {
          targetX = 0;          
          targetY += 1;         
        } else if (targetX < 0) {
          targetX = cols - 1;   
          targetY -= 1;        
        }
      }
      

      const targetNode = currentPaneData.coordinateMap.get(`${targetX},${targetY}`);
      if (targetNode){
        targetNode.focus(); 
      }
    }
    window.addEventListener('keydown', handleKeyDown); 
    return () => window.removeEventListener('keydown', handleKeyDown); 

  }, [activePane]); 

  return (
    <VimContext.Provider value={{activePane, setActivePane, registerPane, unregisterPane, registerNode, unregisterNode}}>
    {children}
    </VimContext.Provider>
  )
} 
