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

function FilterEditor(props) {
  const [daysToShow, setDaysToShow] = useState(props.daysToShow);
  function handleChange(e) {
    const { value } = e.target;
    setDaysToShow(parseInt(value, 10));
  }
  function save() {
    props.save({
      daysToShow,
    });
  }
  return (
    <Modal isOpen={true} toggle={props.cancel}>
      <ModalHeader toggle={props.cancel}>
        Filter logs by
      </ModalHeader>
      <ModalBody>
        <Form>
          <FormGroup>
            <Label for="text">
              How many days to show
            </Label>
            <Input
              id="daysToShow"
              name="daysToShow"
              type="number"
              min={1}
              value={daysToShow}
              onChange={handleChange}
            />
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

export default FilterEditor;
