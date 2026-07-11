import { useEffect, useContext } from 'preact/hooks';
import { VimContext} from './VimProvider';
import type { PaneConfig } from './VimProvider';

export function usePane(name: string, config: PaneConfig){
  const context = useContext(VimContext); 
  if(!context) throw new Error('usePane must be used with a VimProvider'); 
  const {cols, flow, neighbors} = config;
  useEffect(() =>{
    context.registerPane(name, config); 
    return () => {
      context.unregisterPane(name); 
    };
  }, [name,cols, flow, JSON.stringify(neighbors)])
}
