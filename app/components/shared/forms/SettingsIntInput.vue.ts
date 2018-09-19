import { Component, Prop } from 'vue-property-decorator';
import { Input, INumberInputValue } from './Input';
import Vue from 'vue';

@Component
class SettingsIntInput extends Vue {
  $refs: {
    input: HTMLInputElement;
  };

  @Prop() value: number;

  @Prop() step: number;

  @Prop() max: number;

  @Prop() min: number;

  @Prop({ default: false })
  disabled: boolean;

  @Prop({ default: true })
  showDescription: boolean;

  @Prop() description: string;

  /* This takes a number value and updates
   * the string after validating it. If the
   * number is invalid, it will update with
   * a default. */
  private update(value: any) {
    if (isNaN(value)) value = this.min;

    if (value === this.value) {
      this.$refs.input.value = value.toString(10);
      return;
    } else if (value < this.min) value = this.min;
    else if (value > this.max) value = this.max;

    this.$refs.input.value = value.toString(10);
    this.$emit('input', value);
  }

  input(event: Event) {
    this.update(parseInt(this.$refs.input.value, 10));
  }

  increment(event: MouseEvent) {
    const value = parseInt(this.$refs.input.value, 10);
    this.update(value + 1);
  }

  decrement(event: MouseEvent) {
    const value = parseInt(this.$refs.input.value, 10);
    this.update(value - 1);
  }
}

export default SettingsIntInput;
