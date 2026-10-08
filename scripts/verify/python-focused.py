"""Load explicit unittest selections and retain counted execution evidence."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
path = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(path.parent))
spec = importlib.util.spec_from_file_location('fitsy_focused_selection', path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
suite = unittest.defaultTestLoader.loadTestsFromModule(module)
result = unittest.TextTestRunner(verbosity=1).run(suite)
outcome = {'tests_run': result.testsRun, 'skipped': len(result.skipped),
           'failures': len(result.failures), 'errors': len(result.errors),
           'success': result.wasSuccessful() and result.testsRun > len(result.skipped)}
Path(sys.argv[2]).write_text(json.dumps(outcome) + '\n')
sys.exit(0 if outcome['success'] else 1)
