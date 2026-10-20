const api = 'https://world.openfoodfacts.org';

async function json(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Nutrilev/1.0 contact@nutrilev.app' } });
  if (!response.ok) throw new Error(`Open Food Facts ${response.status}`);
  return response.json();
}

export const openFoodFactsService = {
  async searchFoods(query: string) {
    const payload = await json(`${api}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=20`);
    return (payload.products || []).map((item: Record<string, any>) => ({
      id: item.code,
      name: item.product_name,
      calories: item.nutriments?.['energy-kcal_100g'],
      protein: item.nutriments?.proteins_100g,
    }));
  },
  async getFood(id: string) {
    const payload = await json(`${api}/api/v2/product/${encodeURIComponent(id)}.json`);
    return payload.product || null;
  },
  async getFoodByBarcode(barcode: string) {
    return this.getFood(barcode);
  },
};
