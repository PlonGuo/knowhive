---
title: Heap / Priority Queue
category: Data Structures
tags: [heap, priority-queue, greedy, sorting]
difficulty: null
pack_id: leetcode-basics
---

# Heap / Priority Queue

## Core Idea

- **Heap**: a complete binary tree satisfying the heap property (parent >= or <= children)
- **Priority Queue**: abstract data type supporting insert and extract-min/max
- **Python implementation**: `heapq` module (min-heap)

## Key Properties

1. **Heap property**:
   - Max-heap: parent value >= child values
   - Min-heap: parent value <= child values
2. **Complete binary tree**: can be efficiently stored in an array
3. **Operation complexity**:
   - Insert: O(log n)
   - Extract min/max: O(log n)
   - Peek min/max: O(1)

## Use Cases

### 1. Dynamic Extrema

- Real-time median from a data stream
- Maintain top-K elements
- Examples: LC 295, LC 703

### 2. Greedy Algorithm Support

- Track earliest ending meeting (LC 253)
- Distance management in Dijkstra
- Huffman coding

### 3. Merge K Sorted Sequences

- Merge K sorted linked lists (LC 23)
- Merge K sorted arrays

### 4. Scheduling Problems

- Task scheduling (LC 621)
- Meeting room allocation (LC 253)
- CPU task scheduling

## Python heapq Usage

### Basic Operations

```python
import heapq

heap = []

# Push elements
heapq.heappush(heap, 5)
heapq.heappush(heap, 2)
heapq.heappush(heap, 8)

# Peek smallest (without popping)
smallest = heap[0]  # 2

# Pop smallest
smallest = heapq.heappop(heap)  # 2

# Heapify existing list
arr = [3, 1, 4, 1, 5, 9]
heapq.heapify(arr)  # in-place conversion

# Pop smallest and push new element
smallest = heapq.heapreplace(heap, 10)

# Get n largest/smallest
largest_3 = heapq.nlargest(3, arr)
smallest_3 = heapq.nsmallest(3, arr)
```

### Max-Heap Trick (Python only has min-heap)

```python
# Method 1: Negate values
max_heap = []
heapq.heappush(max_heap, -5)  # push 5
heapq.heappush(max_heap, -2)  # push 2
largest = -heapq.heappop(max_heap)  # 5

# Method 2: Custom comparison class
class MaxHeapObj:
    def __init__(self, val):
        self.val = val
    def __lt__(self, other):
        return self.val > other.val  # reversed comparison

max_heap = []
heapq.heappush(max_heap, MaxHeapObj(5))
heapq.heappush(max_heap, MaxHeapObj(2))
largest = heapq.heappop(max_heap).val  # 5
```

### Tuple Storage (compared by first element)

```python
heap = []
heapq.heappush(heap, (3, 'task1'))
heapq.heappush(heap, (1, 'task2'))
heapq.heappush(heap, (2, 'task3'))

while heap:
    priority, task = heapq.heappop(heap)
    print(f"Execute: {task}, priority: {priority}")
```

## Complexity

- **Heapify**: O(n)
- **Insert/Delete**: O(log n)
- **Peek**: O(1)
- **Top K problem**: O(n log k) vs sorting's O(n log n)

## Practice Problems

### Basic Heap Applications

1. LC 253 - Meeting Rooms II (min-heap tracks meeting end times)
2. LC 23 - Merge k Sorted Lists
3. LC 295 - Find Median from Data Stream (dual heap)
4. LC 703 - Kth Largest Element in a Stream

### Scheduling

5. LC 621 - Task Scheduler
6. LC 358 - Rearrange String k Distance Apart
7. LC 767 - Reorganize String

### Heap in Graph Algorithms

8. Dijkstra's algorithm - priority queue optimization
9. Prim's algorithm - minimum spanning tree
10. A* search - heuristic search

## Tips

### Heap vs Sorting

- **Heap**: dynamic data, real-time top-K maintenance, O(n log k)
- **Sorting**: static data, one-time top-K retrieval, O(n log n)

### Dual Heap Technique

- Maintain two heaps (max-heap + min-heap)
- Used for median finding, balancing data streams
- Example: LC 295

## Related Topics

- Greedy Algorithm - often combined with heap
- Graph Theory Overview - Dijkstra and Prim use heaps
- Sorting - alternative for static data
