import { useEffect, useState } from 'react';
import { Animated, BackHandler } from 'react-native';

/** Fermeture par le bouton retour Android tant que le composant est affiché. */
export function useBackToClose(onClose: () => void) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);
}

export function useAppear() {
  const [appear] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [appear]);
  return appear;
}
