import { useEffect, useRef, useContext } from 'preact/hooks';
import { VimContext } from './VimProvider';

export function useNavigable <T extends HTMLElement> (paneName: string) {
  const context = useContext(VimContext); 
  if(!context) throw new Error('useNavigable must be used with a VimProvider'); 
  const nodeRef = useRef<T>(null)
  useEffect(() =>{
    const node = nodeRef.current;
    if(node){
      context.registerNode(paneName, node); 
      if(!node.hasAttribute('tabindex')){
        node.setAttribute('tabindex', '0'); 
      }
    }

    return () => {
      if (node) context.unregisterNode(paneName, node); 
    }
  }, [paneName, context]); 

  return nodeRef;
  
}


