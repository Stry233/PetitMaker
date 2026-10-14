import { Converter } from 'opencc-js/t2cn';

export const simplifiedChinese = Converter({ from: 'tw', to: 'cn' });
