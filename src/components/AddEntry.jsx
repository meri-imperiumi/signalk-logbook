import React, { useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Form,
  FormGroup,
  Label,
  Input,
  InputGroup,
  InputGroupText,
} from 'reactstrap';
import { getSeaStates } from '../helpers/observations';

function AddEntry(props) {
  const [entry, updateEntry] = useState({
    text: '',
    ago: 0,
  });
  function handleChange(e) {
    const { name, value } = e.target;
    const updated = {
      ...entry,
    };
    if (name === 'seaState') {
      if (!updated.observations) {
        updated.observations = {};
      }
      const val = parseInt(value, 10);
      if (val === -1) {
        // No observation
        delete updated.observations[name];
      } else {
        updated.observations[name] = val;
      }
    } else if (name === 'cloudCoverage') {
      if (!updated.observations) {
        updated.observations = {};
      }
      const val = parseInt(value, 10);
      if (val === -1) {
        // No observation
        delete updated.observations[name];
      } else {
        updated.observations[name] = val;
      }
    } else {
      updated[name] = value;
    }
    updateEntry(updated);
  }
  function save() {
    props.save(entry);
  }
  const agoOptions = [
    0,
    5,
    10,
    15,
  ];
  const seaStates = getSeaStates();
  return (
    <Modal isOpen={true} toggle={props.cancel}>
      <ModalHeader toggle={props.cancel}>
        New log entry
      </ModalHeader>
      <ModalBody>
        <Form>
          <FormGroup>
            <Label for="text">
              Remarks
            </Label>
            <Input
              id="text"
              name="text"
              type="textarea"
              placeholder="Tell what happened"
              value={entry.text}
              onChange={handleChange}
            />
          </FormGroup>
          <FormGroup>
            <Label for="ago">
              This happened
            </Label>
            <Input
              id="ago"
              name="ago"
              type="select"
              value={entry.text}
              onChange={handleChange}
            >
              {agoOptions.map((ago) => (
              <option key={ago} value={ago}>{ago} minutes ago</option>
              ))}
            </Input>
          </FormGroup>
          <FormGroup>
            <Label for="category">
              Category
            </Label>
            <Input
              id="category"
              name="category"
              type="select"
              value={entry.category}
              onChange={handleChange}
            >
              {props.categories.map((category) => (
              <option key={category} value={category}>{category}</option>
              ))}
            </Input>
          </FormGroup>
          <legend>Observations</legend>
          <FormGroup>
            <Label for="seaState">
              Sea state
            </Label>
            <Input
              id="seaState"
              name="seaState"
              type="select"
              value={entry.observations ? entry.observations.seaState : -1}
              onChange={handleChange}
            >
              {seaStates.map((description, idx) => (
              <option key={idx} value={idx - 1}>{description}</option>
              ))}
            </Input>
          </FormGroup>
          <FormGroup>
            <Label for="cloudCoverage">
              Cloud coverage
            </Label>
            <InputGroup>
              <Input
                id="cloudCoverage"
                name="cloudCoverage"
                type="range"
                min="-1"
                max="8"
                step="1"
                value={entry.observations ? entry.observations.cloudCoverage : -1}
                onChange={handleChange}
              />
              <InputGroupText>
                {entry.observations
                  && entry.observations.cloudCoverage > -1 ? `${entry.observations.cloudCoverage}/8` : 'n/a'}
              </InputGroupText>
            </InputGroup>
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button color="primary" onClick={save}>
          Save
        </Button>{' '}
        <Button color="secondary" onClick={props.cancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default AddEntry;
