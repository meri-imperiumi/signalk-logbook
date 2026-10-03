import React, { useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Form,
  FormGroup,
  Label,
  Input,
  Button,
} from 'reactstrap';
import { QUICK_RANGES, isCustomFilter } from '../helpers/range';

function FilterEditor(props) {
  const initial = props.filter || { preset: '7d' };
  const custom = isCustomFilter(initial);
  const [preset, setPreset] = useState(custom ? null : initial.preset);
  const [from, setFrom] = useState(custom ? initial.from : '');
  const [to, setTo] = useState(custom ? initial.to : '');

  function selectPreset(key) {
    setPreset(key);
  }
  function selectCustom() {
    setPreset(null);
  }
  function changeFrom(e) {
    setFrom(e.target.value);
    setPreset(null);
  }
  function changeTo(e) {
    setTo(e.target.value);
    setPreset(null);
  }
  function save() {
    if (preset) {
      props.save({ preset });
    } else {
      props.save({ from, to });
    }
  }
  const customComplete = from && to && from <= to;
  const canSave = preset !== null || customComplete;

  return (
    <Modal isOpen={true} toggle={props.cancel}>
      <ModalHeader toggle={props.cancel}>
        Filter logs by date range
      </ModalHeader>
      <ModalBody>
        <Form>
          <FormGroup tag="fieldset">
            <Label>
              Quick ranges
            </Label>
            {QUICK_RANGES.map((range) => (
              <FormGroup check key={range.key}>
                <Label check>
                  <Input
                    type="radio"
                    name="quickRange"
                    value={range.key}
                    checked={preset === range.key}
                    onChange={() => selectPreset(range.key)}
                  />
                  {range.label}
                </Label>
              </FormGroup>
            ))}
          </FormGroup>
          <FormGroup tag="fieldset">
            <Label>
              Custom range
            </Label>
            <FormGroup check>
              <Label check>
                <Input
                  type="radio"
                  name="quickRange"
                  checked={preset === null}
                  onChange={selectCustom}
                />
                From–to dates
              </Label>
            </FormGroup>
            <FormGroup>
              <Label for="from">From</Label>
              <Input
                id="from"
                name="from"
                type="date"
                value={from}
                onChange={changeFrom}
              />
            </FormGroup>
            <FormGroup>
              <Label for="to">To</Label>
              <Input
                id="to"
                name="to"
                type="date"
                value={to}
                onChange={changeTo}
              />
            </FormGroup>
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button color="primary" onClick={save} disabled={!canSave}>
          Save
        </Button>{' '}
        <Button color="secondary" onClick={props.cancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default FilterEditor;
