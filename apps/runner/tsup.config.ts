import { defineConfig } from 'tsup';
import { serviceConfig } from '../../tsup.base';

export default defineConfig(serviceConfig(['core', 'shared']));
