import React from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from 'reactstrap';
import EntryDetails from './EntryDetails.jsx';
import OriginBadge from './OriginBadge.jsx';
import { formatTimestamp } from '../helpers/timezone';

function EntryViewer(props) {
  const { entry } = props;
  return (
    <Modal isOpen={true} toggle={props.cancel}>
      <ModalHeader toggle={props.cancel}>
        Log entry {formatTimestamp(entry.date, props.displayTimeZone)} by {entry.author || 'auto'}
        <OriginBadge origin={entry.origin} />
      </ModalHeader>
      <ModalBody>
        <EntryDetails entry={entry} />
      </ModalBody>
      <ModalFooter>
        <Button color="primary" onClick={() => props.editEntry(entry)}>
          Edit
        </Button>{' '}
        <Button color="secondary" onClick={props.cancel}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default EntryViewer;
