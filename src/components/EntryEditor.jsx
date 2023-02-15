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
  Row,
  Col,
} from 'reactstrap';

function EntryEditor(props) {
  const [entry, updateEntry] = useState(props.entry);
  function handleChange(e) {
    const { name, value } = e.target;
    const updated = {
      ...entry,
    };
    updated[name] = value;
    updateEntry(updated);
  }
  function save() {
    props.save(entry);
  }
  function deleteEntry() {
    props.delete(entry);
  }
  return (
    <Modal isOpen={true} toggle={props.cancel}>
      <ModalHeader toggle={props.cancel}>
        Log entry {entry.date.toLocaleString('en-GB', { timeZone: 'UTC' })} by {entry.author || 'auto'}
      </ModalHeader>
      <ModalBody>
        <Row>
          <Col className="text-end text-right">
            <Button color="danger" onClick={deleteEntry}>
              Delete
            </Button>
          </Col>
        </Row>
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
          { entry.category === 'radio'
            && <FormGroup>
                <Label for="vhf">
                  VHF channel
                </Label>
                <Input
                  id="vhf"
                  name="vhf"
                  placeholder="16"
                  value={entry.vhf}
                  onChange={handleChange}
                />
              </FormGroup>
          }
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

export default EntryEditor;
