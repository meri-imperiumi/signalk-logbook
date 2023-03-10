export function getSeaStates() {
  return [
    '',
    'Glassy calm (0m)',
    'Rippled calm (0-0.1m)',
    'Smooth (0.1-0.5m)',
    'Slight (0.5-1.25m)',
    'Moderate (1.25-2.5m)',
    'Rough (2.5-4m)',
    'Very rough (4-6m)',
    'High (6-9m)',
    'Very high (9-14m)',
    'Phenomenal (14m+)',
  ];
}

export function getOktas() {
  return [
    '\u25EF',
    '\u233D',
    '\u25D4',
    '\u25D4', // No unicode for 3/8
    '\u25D1',
    '\u25D5',
    '\u25D5', // No unicode for 7/8
    '\u2B24',
  ];
}

export function getVisibility() {
  return [
    '',
    'Dense fog (<45m)',
    'Thick fog (<180m)',
    'Fog (<360m)',
    'Moderate fog (<0.5NM)',
    'Thin fog (<1NM)',
    'Poor visibility (<2NM)',
    'Moderate visibility (<5NM)',
    'Good visibility (<10NM)',
    'Very good visibility (<30NM)',
    'Excellent visibility (>30NM)',
  ];
}
